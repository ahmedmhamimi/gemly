/**
 * Persistent data (folders, tone, bookmarks, prompts).
 *
 * Backed by chrome.storage.local rather than the page's localStorage, so
 * Gemini's own scripts can never read or overwrite it.
 *
 * Design:
 *  - Everything is loaded into memory once (`Store.load()`), so reads are
 *    synchronous and free. `get()` returns a DEEP-FROZEN shared snapshot - no
 *    per-read cloning on hot paths, and accidental mutation throws loudly.
 *  - Writes go through `update(name, draft => …)`: clone once, mutate, run
 *    the sanitizer, commit. Commits update memory immediately and persist in
 *    a coalesced batch (one storage write per burst, flushed on tab hide).
 *  - Reads are sanitized (see schema.js) so corrupt/old data can't crash UI.
 *  - Cross-tab changes arrive via chrome.storage.onChanged; echoes of our own
 *    writes are detected and ignored.
 *  - Quota/IO failures are reported (bus 'store-error') instead of swallowed.
 */
import { BACKUP_KEY, CONFIG, STORAGE_KEYS } from './config.js';
import { bus } from './events.js';
import { createLogger, setVerbose } from './log.js';
import { runMigrations } from './migrations.js';
import * as schema from './schema.js';

const log = createLogger('store');

/** name -> { key, sanitize, empty } */
const DEFS = {
  folders: { key: STORAGE_KEYS.folders, sanitize: schema.sanitizeFolders, empty: () => [] },
  assignments: { key: STORAGE_KEYS.assignments, sanitize: schema.sanitizeAssignments, empty: () => ({}) },
  convMeta: { key: STORAGE_KEYS.convMeta, sanitize: schema.sanitizeConvMeta, empty: () => ({}) },
  folderState: { key: STORAGE_KEYS.folderState, sanitize: schema.sanitizeFolderState, empty: () => ({}) },
  tone: { key: STORAGE_KEYS.tone, sanitize: schema.sanitizeTone, empty: () => ({ selectedId: 'none', customTones: [] }) },
  toneLast: { key: STORAGE_KEYS.toneLast, sanitize: schema.sanitizeToneLast, empty: () => ({}) },
  bookmarks: { key: STORAGE_KEYS.bookmarks, sanitize: schema.sanitizeBookmarks, empty: () => ({}) },
  prompts: { key: STORAGE_KEYS.prompts, sanitize: schema.sanitizePrompts, empty: () => null },
  summary: { key: STORAGE_KEYS.summary, sanitize: schema.sanitizeSummary, empty: () => ({ prompt: '', intro: '', hintAt: 70 }) },
  handoff: { key: STORAGE_KEYS.handoff, sanitize: schema.sanitizeHandoff, empty: () => null },
  highlights: { key: STORAGE_KEYS.highlights, sanitize: schema.sanitizeHighlights, empty: () => ({}) },
  personas: { key: STORAGE_KEYS.personas, sanitize: schema.sanitizePersonas, empty: () => ({ items: [], activeId: null, autoSend: false }) },
  chatTags: { key: STORAGE_KEYS.chatTags, sanitize: schema.sanitizeChatTags, empty: () => ({}) },
  archivedChats: { key: STORAGE_KEYS.archivedChats, sanitize: schema.sanitizeArchived, empty: () => ({}) },
  features: { key: STORAGE_KEYS.features, sanitize: schema.sanitizeFeatureFlags, empty: () => ({}) },
};

const NAME_BY_KEY = Object.fromEntries(Object.entries(DEFS).map(([name, d]) => [d.key, name]));

export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const k of Object.keys(value)) deepFreeze(value[k]);
  }
  return value;
}

const clone = (v) => (v === undefined ? v : structuredClone(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

class StoreImpl {
  constructor() {
    this._data = Object.create(null); // name -> frozen sanitized value
    this._pending = new Map(); // key -> value awaiting persistence
    this._timer = null;
    this._loaded = false;
    this._listener = null;
    this._onHide = null;
    /** Test seam: `{ migrations, target }` overrides for core/migrations.js. */
    this._migrationOpts = {};
  }

  get loaded() {
    return this._loaded;
  }

  async load() {
    if (this._loaded) return;
    let raw = {};
    try {
      raw = (await chrome.storage.local.get([...Object.values(STORAGE_KEYS)])) || {};
    } catch (err) {
      log.warn('could not read storage - starting with empty data', err);
    }
    setVerbose(raw[STORAGE_KEYS.debug] === true);
    raw = await this._migrate(raw);
    for (const [name, def] of Object.entries(DEFS)) {
      this._data[name] = deepFreeze(this._sanitize(def, raw[def.key]));
    }
    this._loaded = true;
    this._attach();
  }

  /**
   * Bring stored data up to the current schema version (core/migrations.js).
   * All-or-nothing: on any failure the stored data is left exactly as it was
   * and the sanitizers keep reading it. Never throws.
   */
  async _migrate(raw) {
    const dataKeys = Object.values(DEFS).map((d) => d.key);
    const res = runMigrations(raw, { dataKeys, versionKey: STORAGE_KEYS.schemaVersion, ...this._migrationOpts });
    if (!res.ok) {
      log.error('storage migration failed - data left untouched', res.error);
      bus.emit('migration-error', { message: String(res.error?.message || res.error) });
      return raw;
    }
    if (res.newer) {
      log.warn(`stored data is from a newer version (${res.from}) - leaving it as is`);
      return raw;
    }
    if (!res.applied.length) return raw;

    const next = { ...raw, ...res.writes };
    for (const k of res.removes) delete next[k];
    try {
      // One call: data, version stamp and the one-slot backup land together or not at all.
      await chrome.storage.local.set({
        ...res.writes,
        [STORAGE_KEYS.schemaVersion]: res.to,
        [BACKUP_KEY]: { from: res.from, at: Date.now(), data: res.before },
      });
      if (res.removes.length) await chrome.storage.local.remove(res.removes);
      log.info(`migrated storage ${res.from} -> ${res.to}:`, res.applied.join(', '));
    } catch (err) {
      // Memory holds the migrated shape; the version stays old so the (idempotent) steps rerun next load.
      log.warn('could not persist the migration - it will run again next load', err);
    }
    return next;
  }

  _sanitize(def, value) {
    try {
      const out = def.sanitize(value);
      return out === undefined ? def.empty() : out;
    } catch (err) {
      log.warn(`sanitizer failed for ${def.key}; using empty`, err);
      return def.empty();
    }
  }

  _attach() {
    try {
      this._listener = (changes, area) => {
        if (area !== 'local') return;
        const names = [];
        for (const [key, change] of Object.entries(changes)) {
          if (key === STORAGE_KEYS.debug) setVerbose(change.newValue === true);
          const name = NAME_BY_KEY[key];
          if (!name) continue;
          const next = deepFreeze(this._sanitize(DEFS[name], change.newValue));
          if (same(next, this._data[name])) continue; // echo of our own write
          this._data[name] = next;
          names.push(name);
        }
        if (names.length) bus.emit('store', { names });
      };
      chrome.storage.onChanged.addListener(this._listener);
    } catch (err) {
      log.warn('cannot subscribe to storage changes', err);
    }
    // A hidden/closing tab must not lose a pending write.
    this._onHide = () => {
      if (document.visibilityState === 'hidden') this.flush();
    };
    document.addEventListener('visibilitychange', this._onHide);
    window.addEventListener('pagehide', this._onHide);
  }

  /** @returns {*} deep-frozen shared snapshot - never mutate; use update(). */
  get(name) {
    const def = DEFS[name];
    if (!def) throw new Error(`Unknown store entry "${name}"`);
    if (!(name in this._data)) this._data[name] = deepFreeze(def.empty());
    return this._data[name];
  }

  /**
   * Read-modify-write. The mutator receives a mutable clone and may either
   * mutate it in place or return a replacement value.
   */
  update(name, mutator) {
    const def = DEFS[name];
    if (!def) throw new Error(`Unknown store entry "${name}"`);
    const draft = clone(this.get(name));
    const returned = mutator(draft);
    return this.set(name, returned === undefined ? draft : returned);
  }

  set(name, value) {
    const def = DEFS[name];
    if (!def) throw new Error(`Unknown store entry "${name}"`);
    const next = deepFreeze(this._sanitize(def, clone(value)));
    if (same(next, this._data[name])) return next;
    this._data[name] = next;
    this._pending.set(def.key, next);
    this._schedule();
    return next;
  }

  _schedule() {
    if (this._timer) return;
    this._timer = setTimeout(() => this.flush(), CONFIG.storage.flushDelayMs);
  }

  /** Persist everything pending now. Never throws. */
  flush() {
    clearTimeout(this._timer);
    this._timer = null;
    if (!this._pending.size) return Promise.resolve();
    const batch = Object.fromEntries(this._pending);
    this._pending.clear();
    try {
      return chrome.storage.local.set(batch).catch((err) => this._failed(err));
    } catch (err) {
      // Extension context invalidated (reloaded/updated) - nothing to do.
      return Promise.resolve(this._failed(err));
    }
  }

  _failed(err) {
    const message = String(err?.message || err);
    const quota = /quota/i.test(message);
    log.error(quota ? 'storage quota exceeded - changes are NOT saved' : 'storage write failed', err);
    bus.emit('store-error', { quota, message });
  }

  dispose() {
    this.flush();
    try {
      if (this._listener) chrome.storage.onChanged.removeListener(this._listener);
    } catch {
      /* context gone */
    }
    if (this._onHide) {
      document.removeEventListener('visibilitychange', this._onHide);
      window.removeEventListener('pagehide', this._onHide);
    }
    this._listener = this._onHide = null;
    this._loaded = false;
  }
}

export const Store = new StoreImpl();
