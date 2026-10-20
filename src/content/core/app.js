/**
 * The application core: owns the feature registry, the mutation pipeline and
 * the lifecycle. Features never run their own page observers - they declare
 * which page zones they care about and implement an idempotent `scan()`.
 *
 *   mutation records ──► zones + dirty turns ──► Scheduler ──► features
 *
 * @typedef {'sidebar'|'composer'|'chat'|'global'} Zone
 *
 * @typedef {Object} ScanContext
 * @property {Set<string>} zones      dirty zones for this scan
 * @property {boolean} all            true => treat every zone as dirty
 * @property {boolean} generating     Gemini is streaming a reply
 * @property {Element[]} turns        chat turns, DOM order (memoized per scan)
 * @property {HTMLAnchorElement[]} links  sidebar chat links (memoized per scan)
 *
 * @typedef {Object} AppContext
 * @property {typeof import('../host/gemini.js').GeminiHost} host
 * @property {import('./message-index.js').MessageIndex} index
 * @property {(target: EventTarget, type: string, fn: Function, opts?: any) => void} listen
 *           addEventListener that is removed automatically on shutdown
 * @property {(fn: () => void) => void} onDispose   register a cleanup callback
 * @property {(zone?: string) => void} requestScan  ask for a scan (optionally marking a zone dirty)
 *
 * @typedef {Object} Feature
 * @property {string} id
 * @property {Zone[]} zones   scan() runs when any of these (or 'global') is dirty
 * @property {(ctx: AppContext) => void} [init]        once, before the first scan
 * @property {(scan: ScanContext, ctx: AppContext) => void} [scan]  idempotent reconcile
 * @property {() => void} [teardown]  remove injected UI/state (shutdown + locale rebuild)
 */
import { CONFIG } from './config.js';
import { diagnose, healthCheck } from './diagnostics.js';
import { bus } from './events.js';
import { Features } from './feature-registry.js';
import { Disposables, evictPreviousInstances, isContextAlive, onEvicted, sweepOrphans } from './lifecycle.js';
import { createLogger } from './log.js';
import { MessageIndex } from './message-index.js';
import { Scheduler } from './scheduler.js';
import { Store } from './store.js';
import { resetTheme, syncTheme } from './theme.js';
import { GeminiHost as host } from '../host/gemini.js';
import { Lang } from '../i18n/index.js';
import { isOwn, isOwnMutation } from '../util/dom.js';

const log = createLogger('app');

export class App {
  /** @param {Feature[]} features */
  constructor(features) {
    const seen = new Set();
    for (const f of features) {
      if (seen.has(f.id)) throw new Error(`Duplicate feature id "${f.id}"`);
      seen.add(f.id);
    }
    this.features = features.map((f) => ({ def: f, failures: 0, disabled: false, mounted: false }));
    /** Features switched off by features/manifest.js or the user's settings: never init'd or scanned. */
    this.inactive = [];
    this.index = new MessageIndex();
    this.disposables = new Disposables();
    this._observer = null;
    this._composerObserver = null;
    this._composerRoot = null;
    this._scheduler = null;
    this._lastHref = location.href;
    this._scans = 0;
    this._lastHealth = 0;
    this._wasGenerating = false;
    this._dead = false;
    /** @type {AppContext} */
    this.ctx = {
      host,
      index: this.index,
      listen: (t, type, fn, opts) => this.disposables.listen(t, type, fn, opts),
      onDispose: (fn) => this.disposables.add(fn),
      requestScan: (zone) => {
        if (zone) this._scheduler?.mark(zone);
        else this._scheduler?.markAll();
        this._scheduler?.request();
      },
    };
  }

  // ---------------------------------------------------------------- lifecycle

  async start() {
    evictPreviousInstances();
    sweepOrphans();
    this.disposables.add(onEvicted(() => this.shutdown('replaced by a newer instance')));

    await Store.load();
    if (this._dead) return;

    this._applyFeatureFlags();

    syncTheme();
    Lang.sync();

    this._scheduler = new Scheduler({
      run: (batch) => this._runScan(batch),
      intervalMs: () => (this._wasGenerating ? CONFIG.scheduler.streamingIntervalMs : CONFIG.scheduler.idleIntervalMs),
    });

    for (const f of this.features) this._guard(f, 'init', () => f.def.init?.(this.ctx));

    this._wireGlobalSources();

    window.__gemly = { diagnose: () => diagnose(this) };
    this.disposables.add(() => {
      delete window.__gemly;
    });

    this._observer = new MutationObserver((records) => this._onMutations(records));
    this._observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    this.disposables.add(() => {
      this._observer?.disconnect();
      this._composerObserver?.disconnect();
    });

    this._scheduler.markAll();
    this._scheduler.request({ immediate: false });
    setTimeout(() => this.ctx.requestScan(), CONFIG.scheduler.initialScanDelayMs);
    log.info('started');
  }

  shutdown(reason = 'shutdown') {
    if (this._dead) return;
    this._dead = true;
    log.info('shutting down:', reason);
    this._scheduler?.dispose();
    for (const f of this.features) this._teardown(f);
    this.disposables.dispose();
    try {
      Store.dispose();
    } catch {
      /* context gone */
    }
    bus.clear();
    resetTheme();
    sweepOrphans();
  }

  /**
   * Resolve the central feature switches (manifest + the person's overrides) and
   * drop the features that are off. Takes effect for this page load: hot-swapping
   * init() listeners is deliberately not attempted.
   */
  _applyFeatureFlags() {
    Features.resolve(Store.get('features'));
    const keep = [];
    this.inactive = [];
    for (const f of this.features) {
      if (Features.isEnabled(f.def.id)) keep.push(f);
      else this.inactive.push({ id: f.def.id, reason: Features.reason(f.def.id) });
    }
    this.features = keep;
    for (const { id, reason } of this.inactive) log.info(`feature "${id}" is off (${reason})`);
  }

  get scanCount() {
    return this._scans;
  }

  featureStatus() {
    return this.features.map((f) => ({ id: f.def.id, disabled: f.disabled, failures: f.failures }));
  }

  // ------------------------------------------------------------------ sources

  _wireGlobalSources() {
    // Another tab changed persisted data: every feature re-renders from the store.
    this.disposables.add(
      bus.on('store', () => {
        this.index.invalidateAll();
        this.ctx.requestScan();
      }),
    );

    // The page language changed: rebuild all injected UI so labels re-translate.
    this.disposables.add(
      bus.on('locale', () => {
        for (const f of this.features) this._teardown(f);
        this.ctx.requestScan();
      }),
    );

    // SPA navigation. The Navigation API sees pushState from the PAGE's world
    // (patching history.pushState from here would not); the href check in
    // every scan is the fallback for browsers without it.
    if ('navigation' in window) {
      this.disposables.listen(window.navigation, 'navigatesuccess', () => this._checkNavigation());
    }
    this.disposables.listen(window, 'popstate', () => this._checkNavigation());
    this.disposables.listen(window, 'pageshow', () => this.ctx.requestScan());
  }

  _checkNavigation() {
    if (location.href === this._lastHref) return;
    const from = this._lastHref;
    this._lastHref = location.href;
    this.index.invalidateAll();
    log.debug('navigate', from, '->', location.href);
    bus.emit('navigate', { from, to: location.href });
    this.ctx.requestScan();
  }

  _onMutations(records) {
    if (this._dead) return;
    try {
      this._classify(records);
    } catch (err) {
      // Never let a classification error stop the observer: just rescan everything.
      log.warnOnce('classify', 'mutation classification failed', err);
      this._scheduler.markAll();
      this._scheduler.request();
    }
  }

  _classify(records) {
    const { maxRecordsInspected } = CONFIG.scheduler;
    const stride = Math.max(1, Math.ceil(records.length / maxRecordsInspected));
    let touched = false;

    for (let i = 0; i < records.length; i += stride) {
      const r = records[i];
      if (stride === 1 ? isOwnMutation(r) : isOwn(r.target)) continue;
      const zone = host.zoneOf(r.target);
      if (zone === 'other') continue;
      touched = true;
      this._scheduler.mark(zone);
      if (zone === 'chat') {
        const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
        const turn = el?.closest(host.turnSelector);
        if (turn) this.index.invalidate(turn);
      }
    }
    // A big batch while streaming: the last turn is what is changing.
    if (stride > 1 && this._wasGenerating) {
      const turns = host.turns();
      if (turns.length) this.index.invalidate(turns[turns.length - 1]);
    }
    if (touched) this._scheduler.request();
  }

  // --------------------------------------------------------------------- scan

  _runScan(batch) {
    if (this._dead) return;
    try {
      this._scan(batch);
    } catch (err) {
      log.error('scan failed', err);
    }
  }

  _scan({ zones, all }) {
    if (!isContextAlive()) {
      // Extension was reloaded/updated: this orphaned copy can no longer work.
      this.shutdown('extension context invalidated');
      return;
    }
    this._scans++;
    this._checkNavigation();
    syncTheme();
    Lang.sync();

    const generating = host.isGenerating();
    if (generating !== this._wasGenerating) {
      this._wasGenerating = generating;
      bus.emit('generating', { on: generating });
    } else {
      this._wasGenerating = generating;
    }

    let turns;
    let links;
    /** @type {ScanContext} */
    const scan = {
      zones,
      all,
      generating,
      get turns() {
        return (turns ??= host.turns());
      },
      get links() {
        return (links ??= host.sidebarLinks());
      },
    };

    for (const f of this.features) {
      if (f.disabled || !f.def.scan) continue;
      const wanted = all || zones.has('global') || f.def.zones.some((z) => zones.has(z));
      if (!wanted && f.mounted) continue;
      this._guard(f, 'scan', () => f.def.scan(scan, this.ctx));
      f.mounted = true;
    }

    this._watchComposer();

    const now = performance.now();
    if (now - this._lastHealth > 5000 && this._scans > 2) {
      this._lastHealth = now;
      healthCheck();
    }
  }

  /**
   * Whether Gemini is generating is signalled by the send button flipping to
   * "stop" - often only a class/attribute change, which the page-wide observer
   * (child/text changes only, for cost) cannot see. Watch attributes on the
   * small composer subtree alone.
   */
  _watchComposer() {
    const root = host.composerRoot();
    if (root === this._composerRoot) return;
    this._composerObserver?.disconnect();
    this._composerRoot = root;
    if (!root) return;
    this._composerObserver ??= new MutationObserver((records) => {
      if (this._dead || records.every((r) => isOwn(r.target))) return;
      this._scheduler.mark('composer');
      this._scheduler.request();
    });
    this._composerObserver.observe(root, {
      attributes: true,
      subtree: true,
      attributeFilter: ['class', 'disabled', 'aria-label', 'aria-disabled'],
    });
  }

  // ----------------------------------------------------------------- failures

  /** Run a feature hook; isolate and count failures so one feature can't take down the rest. */
  _guard(f, hook, fn) {
    try {
      fn();
      if (hook === 'scan') f.failures = 0;
    } catch (err) {
      f.failures++;
      log.error(`feature "${f.def.id}" ${hook} failed (${f.failures}/${CONFIG.scheduler.maxConsecutiveFailures})`, err);
      if (f.failures >= CONFIG.scheduler.maxConsecutiveFailures || hook === 'init') {
        f.disabled = true;
        log.error(`feature "${f.def.id}" disabled for this session`);
        this._teardown(f);
      }
    }
  }

  _teardown(f) {
    f.mounted = false;
    try {
      f.def.teardown?.();
    } catch (err) {
      log.warn(`feature "${f.def.id}" teardown failed`, err);
    }
  }
}
