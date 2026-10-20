/**
 * In-conversation search with next/previous.
 *
 * A floating pill at the top centre of the chat: one search icon that expands
 * into the full bar (click it, or Ctrl/Cmd+Shift+F). Matches are painted with
 * the CSS Custom Highlight API, so Gemini's DOM is never modified - no wrapper
 * spans, no fighting Angular's change detection, no observer loops.
 *
 * Matching is done on each message's text as ONE string (matches can span
 * inline elements like <strong>), with a separator between blocks so words
 * never join across paragraphs, and case-folding that never changes string
 * length (so match offsets stay valid for every script, e.g. Turkish İ).
 */
import { CONFIG, IDS } from '../../core/config.js';
import { bus } from '../../core/events.js';
import { GeminiHost as host } from '../../host/gemini.js';
import { Lang } from '../../i18n/index.js';
import { icon } from '../../ui/icons.js';
import { buildTextMap, findRanges } from './text-map.js';
import { debounce, escapeHtml, foldCase } from '../../util/text.js';

const supportsHighlights = typeof CSS !== 'undefined' && !!CSS.highlights && typeof Highlight !== 'undefined';
const isMac = () => /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
const shortcutLabel = () => (isMac() ? '\u2318\u21e7F' : 'Ctrl+Shift+F');

let el = null;
let matches = []; // [{ range, turn }]
let index = -1;
let lastTurnCount = 0;
let lastTurns = [];

function clearHighlights() {
  if (!supportsHighlights) return;
  CSS.highlights.delete('gemly-search');
  CSS.highlights.delete('gemly-search-active');
}

function updateCount() {
  const countEl = document.getElementById(IDS.searchCount);
  const input = document.getElementById(IDS.searchInput);
  if (!countEl) return;
  const hasQuery = !!input?.value.trim();
  if (!hasQuery) {
    countEl.textContent = '';
    countEl.dataset.state = '';
  } else if (!matches.length) {
    countEl.textContent = '0';
    countEl.dataset.state = 'none';
  } else {
    countEl.textContent = `${index + 1}/${matches.length}`;
    countEl.dataset.state = 'some';
  }
}

function textRoots(turns) {
  return turns.map((turn) => ({
    turn,
    root: (host.isUserTurn(turn) ? host.userTextRoot(turn) : host.assistantRoot(turn)) || turn,
  }));
}

/** @param {boolean} keepPosition re-run silently (content changed) without jumping */
function run(query, { keepPosition = false } = {}) {
  clearHighlights();
  const prevIndex = index;
  matches = [];
  index = -1;
  const term = foldCase(query.trim());
  if (!term) return updateCount();

  outer: for (const { turn, root } of textRoots(lastTurns)) {
    const map = buildTextMap(root);
    for (const range of findRanges(map, term)) {
      matches.push({ range, turn });
      if (matches.length >= CONFIG.search.maxMatches) break outer;
    }
  }
  if (supportsHighlights && matches.length) {
    CSS.highlights.set('gemly-search', new Highlight(...matches.map((m) => m.range)));
  }
  if (!matches.length) return updateCount();
  if (keepPosition && prevIndex >= 0) {
    index = Math.min(prevIndex, matches.length - 1);
    if (supportsHighlights) CSS.highlights.set('gemly-search-active', new Highlight(matches[index].range));
    updateCount();
  } else {
    goTo(0);
  }
}

function goTo(i) {
  index = i;
  const m = matches[i];
  if (!m) return;
  if (supportsHighlights) CSS.highlights.set('gemly-search-active', new Highlight(m.range));
  const target = m.range.startContainer.parentElement || m.turn;
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  updateCount();
}

function navigate(dir) {
  if (!matches.length) return;
  goTo((index + dir + matches.length) % matches.length);
}

const debouncedRun = debounce((q) => run(q), CONFIG.search.debounceMs);
const debouncedRefresh = debounce((q) => run(q, { keepPosition: true }), CONFIG.search.debounceMs);

function open() {
  if (!el) return;
  el.dataset.open = 'true';
  const input = el.querySelector('input');
  setTimeout(() => {
    input.focus();
    input.select();
  }, 60);
  if (input.value) run(input.value);
}

function close() {
  if (!el) return;
  el.dataset.open = 'false';
  clearHighlights();
  matches = [];
  index = -1;
  updateCount();
}

function build() {
  const root = document.createElement('div');
  root.id = IDS.searchBar;
  root.className = 'gl-ui gl-search';
  root.dataset.visible = 'false';
  root.dataset.open = 'false';
  root.setAttribute('role', 'search');
  root.innerHTML =
    `<button type="button" class="gl-icon-btn gl-search__toggle" aria-label="${escapeHtml(Lang.t('search.chat.open'))}" data-gl-tip="${escapeHtml(Lang.t('search.chat.shortcut', { shortcut: shortcutLabel() }))}">${icon('search', 18)}</button>` +
    '<div class="gl-search__body">' +
    `<input id="${IDS.searchInput}" class="gl-search__input" type="text" autocomplete="off" spellcheck="false" aria-label="${escapeHtml(Lang.t('search.chat.placeholder'))}" placeholder="${escapeHtml(Lang.t('search.chat.placeholder'))}">` +
    `<span id="${IDS.searchCount}" class="gl-search__count" aria-live="polite"></span><span class="gl-search__sep"></span>` +
    `<button type="button" class="gl-icon-btn" data-act="prev" aria-label="${escapeHtml(Lang.t('search.prev.title'))}" data-gl-tip="${escapeHtml(Lang.t('search.prev.title'))}">${icon('chevronUp', 16)}</button>` +
    `<button type="button" class="gl-icon-btn" data-act="next" aria-label="${escapeHtml(Lang.t('search.next.title'))}" data-gl-tip="${escapeHtml(Lang.t('search.next.title'))}">${icon('chevronDown', 16)}</button>` +
    `<button type="button" class="gl-icon-btn" data-act="clear" aria-label="${escapeHtml(Lang.t('search.clear.title'))}" data-gl-tip="${escapeHtml(Lang.t('search.clear.title'))}">${icon('close', 15)}</button>` +
    '</div>';

  const input = root.querySelector('input');
  root.querySelector('.gl-search__toggle').addEventListener('click', () => (root.dataset.open === 'true' ? close() : open()));
  root.querySelector('[data-act="prev"]').addEventListener('click', () => navigate(-1));
  root.querySelector('[data-act="next"]').addEventListener('click', () => navigate(1));
  root.querySelector('[data-act="clear"]').addEventListener('click', () => {
    if (input.value) {
      input.value = '';
      run('');
      input.focus();
    } else close();
  });
  input.addEventListener('input', () => debouncedRun(input.value));
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      navigate(e.shiftKey ? -1 : 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigate(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigate(-1);
    } else if (e.key === 'Escape') close();
  });
  return root;
}

/** @type {import('../../core/app.js').Feature} */
export const chatSearchFeature = {
  id: 'chat-search',
  zones: ['chat'],
  init(ctx) {
    ctx.listen(document, 'keydown', (e) => {
      if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || !e.shiftKey || e.key.toLowerCase() !== 'f') return;
      if (el?.dataset.visible !== 'true') return;
      e.preventDefault();
      open();
    });
    ctx.onDispose(() => {
      debouncedRun.cancel();
      debouncedRefresh.cancel();
    });
    ctx.onDispose(bus.on('navigate', close));
  },
  scan(scan) {
    if (!el?.isConnected) {
      el = build();
      document.body.appendChild(el);
    }
    lastTurns = scan.turns;
    const has = scan.turns.length > 0;
    const visible = String(has);
    if (el.dataset.visible !== visible) el.dataset.visible = visible;
    if (!has && el.dataset.open === 'true') close();

    // Content changed (streaming / history loaded) while a search is active.
    if (el.dataset.open === 'true' && scan.turns.length !== lastTurnCount) {
      const q = el.querySelector('input').value;
      if (q.trim()) debouncedRefresh(q);
    }
    lastTurnCount = scan.turns.length;
  },
  teardown() {
    clearHighlights();
    el?.remove();
    el = null;
    matches = [];
    index = -1;
  },
};
