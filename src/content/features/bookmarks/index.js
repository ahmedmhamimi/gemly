/**
 * Bookmarks: bookmark any message and jump back to it from a slim dock on the
 * right edge. Gemini exposes no stable message id, so a message's identity is
 * a hash of its own text PLUS its predecessor's (so repeated prompts like
 * "continue" don't collide, and loading older history doesn't shift keys).
 * Stored per conversation. Jumping works for messages Gemini has loaded.
 */
import { CONFIG, IDS } from '../../core/config.js';
import { bus } from '../../core/events.js';
import { Store } from '../../core/store.js';
import { GeminiHost as host } from '../../host/gemini.js';
import { Lang } from '../../i18n/index.js';
import { icon } from '../../ui/icons.js';
import { Popover } from '../../ui/popover.js';
import { escapeHtml, truncate } from '../../util/text.js';

const HOST_ATTR = 'data-gemly-bm-host';
const BTN = '.gl-bm-btn';

let lastScan = null; // { turns, index } from the latest scan, for click handlers
let panelEl = null;

const convId = () => host.currentConversationId();
const list = (id) => (id ? Store.get('bookmarks')[id] || [] : []);

/** Stable key for turn i: role + own hash + previous turn's hash. */
export function keyOf(index, turns, i) {
  const e = index.entry(turns[i]);
  const prev = i > 0 ? index.entry(turns[i - 1]).hash : '';
  return `${e.role[0]}:${e.hash}:${prev}`;
}

function toggle(index, turns, i) {
  const id = convId();
  if (!id) return;
  const key = keyOf(index, turns, i);
  const entry = index.entry(turns[i]);
  Store.update('bookmarks', (all) => {
    const items = all[id] || [];
    const at = items.findIndex((b) => b.key === key);
    if (at >= 0) items.splice(at, 1);
    else {
      items.push({ key, role: entry.role, snippet: truncate(entry.head, CONFIG.bookmarks.snippetLength), addedAt: Date.now() });
      bus.emit('activity', { kind: 'bookmark' });
    }
    if (items.length) all[id] = items;
    else delete all[id];
  });
  refresh();
}

function refresh() {
  if (lastScan) updateButtons(lastScan);
  updateDock(lastScan?.turns.length > 0);
  if (panelEl?.isConnected) renderPanel();
}

// ----------------------------------------------------------- per-message button

function updateButtons({ turns, index, generating }) {
  const id = convId();
  const marked = new Set(list(id).map((b) => b.key));
  turns.forEach((turn, i) => {
    if (!id) return;
    if (generating && i === turns.length - 1 && !host.isUserTurn(turn)) return; // still streaming
    let btn = turn.querySelector(`:scope > ${BTN}`);
    if (!btn) {
      turn.setAttribute(HOST_ATTR, 'true');
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gl-ui gl-icon-btn gl-bm-btn';
      btn.innerHTML = icon('bookmark', 17);
      turn.appendChild(btn);
    }
    const on = marked.has(keyOf(index, turns, i));
    const flag = String(on);
    if (btn.dataset.on !== flag) {
      btn.dataset.on = flag;
      const tip = Lang.t(on ? 'bookmarks.remove.title' : 'bookmarks.add.title');
      btn.dataset.glTip = tip;
      btn.setAttribute('aria-label', tip);
      btn.setAttribute('aria-pressed', flag);
    }
  });
}

// --------------------------------------------------------------------- dock

function updateDock(hasTurns) {
  const id = convId();
  let dock = document.getElementById(IDS.bookmarkDock);
  if (!dock?.isConnected) {
    dock = document.createElement('button');
    dock.id = IDS.bookmarkDock;
    dock.type = 'button';
    dock.className = 'gl-ui gl-bm-dock';
    dock.dataset.glTip = Lang.t('bookmarks.launcher.title');
    dock.setAttribute('aria-label', Lang.t('bookmarks.launcher.title'));
    dock.innerHTML = `${icon('bookmark', 18)}<span id="${IDS.bookmarkBadge}" class="gl-bm-dock__badge">0</span>`;
    dock.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = Popover.current();
      if (open?.anchor === dock) open.close();
      else openPanel(dock);
    });
    document.body.appendChild(dock);
  }
  const count = list(id).length;
  const visible = String(!!(id && hasTurns));
  if (dock.dataset.visible !== visible) dock.dataset.visible = visible;
  if (dock.dataset.count !== String(count)) {
    dock.dataset.count = String(count);
    dock.querySelector(`#${IDS.bookmarkBadge}`).textContent = String(count);
  }
  if (!id && Popover.current()?.anchor === dock) Popover.closeAll();
}

function openPanel(dock) {
  const panel = document.createElement('div');
  panel.id = IDS.bookmarkPanel;
  panel.className = 'gl-ui gl-pop gl-pop--glass gl-bm-panel';
  panel.innerHTML =
    `<div class="gl-pop__head"><span class="gl-pop__title">${escapeHtml(Lang.t('bookmarks.panel.title'))}</span>` +
    `<button type="button" class="gl-icon-btn gl-bm-close" aria-label="${escapeHtml(Lang.t('bookmarks.panel.close'))}" data-gl-tip="${escapeHtml(Lang.t('bookmarks.panel.close'))}">${icon('close', 15)}</button></div>` +
    '<div class="gl-bm-list gl-scroll"></div>';
  panel.querySelector('.gl-bm-close').addEventListener('click', () => Popover.closeAll());
  panelEl = panel;
  renderPanel();
  Popover.open({ anchor: dock, content: panel, placement: 'bottom', align: 'end', onClose: () => (panelEl = null) });
}

function renderPanel() {
  const box = panelEl?.querySelector('.gl-bm-list');
  if (!box) return;
  const id = convId();
  const items = list(id);
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'gl-bm-empty';
    empty.textContent = Lang.t('bookmarks.panel.empty');
    box.replaceChildren(empty);
    return;
  }
  box.replaceChildren(
    ...items.map((entry) => {
      const row = document.createElement('div');
      row.className = 'gl-bm-row';
      row.dataset.role = entry.role;
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.innerHTML =
        `<span class="gl-bm-row__role">${entry.role === 'user' ? Lang.t('pdf.you').slice(0, 1) : 'G'}</span>` +
        `<span class="gl-bm-row__snippet" dir="auto">${escapeHtml(entry.snippet)}</span>`;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'gl-icon-btn';
      del.dataset.glTip = Lang.t('bookmarks.remove.title');
      del.setAttribute('aria-label', Lang.t('bookmarks.remove.title'));
      del.innerHTML = icon('close', 13);
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        Store.update('bookmarks', (all) => {
          all[id] = (all[id] || []).filter((b) => b.key !== entry.key);
          if (!all[id].length) delete all[id];
        });
        refresh();
      });
      row.appendChild(del);
      const go = () => goTo(entry.key);
      row.addEventListener('click', go);
      row.addEventListener('keydown', (e) => {
        if (e.target === row && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          go();
        }
      });
      return row;
    }),
  );
}

function goTo(key) {
  if (!lastScan) return;
  const { turns, index } = lastScan;
  const at = turns.findIndex((_, i) => keyOf(index, turns, i) === key);
  if (at < 0) {
    const n = document.createElement('div');
    n.className = 'gl-bm-notice';
    n.textContent = Lang.t('bookmarks.panel.notLoaded');
    panelEl?.querySelector('.gl-bm-notice')?.remove();
    panelEl?.appendChild(n);
    setTimeout(() => n.remove(), 3200);
    return;
  }
  const target = turns[at];
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  target.classList.add('gl-flash-target');
  setTimeout(() => target.classList.remove('gl-flash-target'), 1900);
}

/** @type {import('../../core/app.js').Feature} */
export const bookmarksFeature = {
  id: 'bookmarks',
  zones: ['chat'],
  init(ctx) {
    ctx.listen(document, 'click', (e) => {
      const btn = e.target.closest?.(BTN);
      if (!btn || !lastScan) return;
      e.preventDefault();
      e.stopPropagation();
      const turn = btn.closest(host.turnSelector);
      // Gemini may have re-rendered since the last scan: fall back to a fresh query.
      const turns = turn && lastScan.turns.includes(turn) ? lastScan.turns : host.turns();
      const i = turn ? turns.indexOf(turn) : -1;
      if (i >= 0) toggle(lastScan.index, turns, i);
    }, true);
    ctx.onDispose(bus.on('store', ({ names }) => names.includes('bookmarks') && refresh()));
    ctx.onDispose(bus.on('navigate', () => Popover.closeAll()));
  },
  scan(scan, ctx) {
    lastScan = { turns: scan.turns, index: ctx.index, generating: scan.generating };
    refresh();
  },
  teardown() {
    document.getElementById(IDS.bookmarkDock)?.remove();
    document.querySelectorAll(BTN).forEach((b) => b.remove());
    document.querySelectorAll(`[${HOST_ATTR}]`).forEach((el) => el.removeAttribute(HOST_ATTR));
    panelEl = null;
    lastScan = null;
  },
};
