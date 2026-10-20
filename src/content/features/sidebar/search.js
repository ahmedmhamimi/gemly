/** Filters Gemini's sidebar chat list by title (the chats Gemini has loaded). */
import { IDS } from '../../core/config.js';
import { Store } from '../../core/store.js';
import { GeminiHost as host } from '../../host/gemini.js';
import { Lang } from '../../i18n/index.js';
import { icon } from '../../ui/icons.js';
import { foldCase, escapeHtml } from '../../util/text.js';
import { mountSidebarBlock, unmountSidebarBlocks } from './blocks.js';

const ORDER = 10;

function build(apply) {
  const box = document.createElement('div');
  box.id = IDS.sidebarSearchBar;
  box.className = 'gl-ui gl-sidebar-search';
  box.setAttribute('role', 'search');
  box.innerHTML =
    `${icon('search', 16)}` +
    `<input id="${IDS.sidebarSearchInput}" type="text" autocomplete="off" spellcheck="false" aria-label="${escapeHtml(Lang.t('search.sidebar.placeholder'))}" placeholder="${escapeHtml(Lang.t('search.sidebar.placeholder'))}">` +
    `<button type="button" class="gl-icon-btn" aria-label="${escapeHtml(Lang.t('search.clear.title'))}" data-gl-tip="${escapeHtml(Lang.t('search.clear.title'))}">${icon('close', 14)}</button>`;
  const input = box.querySelector('input');
  input.addEventListener('input', () => apply());
  // Gemini binds global shortcuts; typing here must not trigger them.
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') clear();
  });
  box.querySelector('button').addEventListener('click', clear);
  return box;
}

function clear() {
  const input = document.getElementById(IDS.sidebarSearchInput);
  if (!input) return;
  input.value = '';
  apply();
  input.focus();
}

function apply(links) {
  const input = document.getElementById(IDS.sidebarSearchInput);
  const box = document.getElementById(IDS.sidebarSearchBar);
  if (!input || !box) return;
  const term = foldCase(input.value.trim());
  box.dataset.hasText = String(!!term);

  const all = links || host.sidebarLinks();
  let visible = 0;
  for (const link of all) {
    const tags = Store.get('chatTags')[host.conversationId(link.getAttribute('href'))] || [];
    const show = !term || foldCase(host.linkTitle(link)).includes(term) || tags.some((t) => foldCase(t).includes(term));
    host.rowFor(link).classList.toggle('gl-hidden', !show);
    if (show) visible++;
  }

  let note = document.getElementById(IDS.sidebarNone);
  if (term && all.length && !visible) {
    if (!note) {
      note = document.createElement('div');
      note.id = IDS.sidebarNone;
      note.className = 'gl-ui gl-sidebar-none';
      box.insertAdjacentElement('afterend', note);
    }
    note.textContent = Lang.t('search.sidebar.none');
  } else {
    note?.remove();
  }
}

/** @type {import('../../core/app.js').Feature} */
export const sidebarSearchFeature = {
  id: 'sidebar-search',
  zones: ['sidebar'],
  scan(scan) {
    let box = document.getElementById(IDS.sidebarSearchBar);
    if (!box?.isConnected) {
      box = build(() => apply());
      if (!mountSidebarBlock(box, ORDER)) return;
    }
    // Gemini re-renders / lazy-loads rows: keep an active filter applied.
    if (document.getElementById(IDS.sidebarSearchInput)?.value.trim()) apply(scan.links);
  },
  teardown() {
    document.getElementById(IDS.sidebarSearchBar)?.remove();
    document.getElementById(IDS.sidebarNone)?.remove();
    document.querySelectorAll('.gl-hidden').forEach((el) => el.classList.remove('gl-hidden'));
    unmountSidebarBlocks();
  },
};
