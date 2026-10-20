/**
 * Search across every saved chat: keyword, date range, folder; highlighted
 * snippets; click to open. Queries run in the service worker (the index lives
 * there), so typing never blocks the page.
 */
import { ArchiveClient } from '../../core/archive-client.js';
import { IDS } from '../../core/config.js';
import { createLogger } from '../../core/log.js';
import { Store } from '../../core/store.js';
import { GeminiHost as host } from '../../host/gemini.js';
import { Lang } from '../../i18n/index.js';
import { Modal } from '../../ui/modal.js';
import { h } from '../../util/dom.js';
import { chatsInFolder } from '../backup/sources.js';
import { dayEnd, dayStart, splitByRanges } from './render.js';

const log = createLogger('archive-search');

function highlighted(tag, cls, text, ranges) {
  const el = h(tag, { cls, attrs: { dir: 'auto' } });
  for (const seg of splitByRanges(text, ranges)) {
    if (seg.hit) el.appendChild(h('mark', { cls: 'gl-hit', text: seg.text }));
    else el.append(document.createTextNode(seg.text));
  }
  return el;
}

/** Open the chat in the page. Sidebar link when it is loaded (SPA), otherwise the saved path. */
export function openResult(item) {
  Modal.closeAll();
  if (host.openConversation(item.id)) return true;
  if (item.path && item.path.startsWith('/') && !item.path.startsWith('//')) {
    location.assign(item.path);
    return true;
  }
  return false;
}

export function openSearchDialog() {
  const content = h('div');
  Modal.open({ title: Lang.t('gsearch.title'), content, width: 640, id: IDS.searchDialog });

  const input = h('input', { cls: 'gl-input', attrs: { type: 'search', autocomplete: 'off', autofocus: '', placeholder: Lang.t('gsearch.placeholder'), 'aria-label': Lang.t('gsearch.placeholder') } });
  const from = h('input', { cls: 'gl-input', attrs: { type: 'date', 'aria-label': Lang.t('gsearch.from') } });
  const to = h('input', { cls: 'gl-input', attrs: { type: 'date', 'aria-label': Lang.t('gsearch.to') } });
  const folders = Store.get('folders');
  const folderSel = h('select', { cls: 'gl-select', attrs: { 'aria-label': Lang.t('gsearch.folder') }, children: [h('option', { attrs: { value: '' }, text: Lang.t('gsearch.folder.all') }), ...folders.map((f) => h('option', { attrs: { value: f.id }, text: f.name }))] });
  const filters = h('div', { cls: 'gl-filters', children: [
    h('label', { cls: 'gl-filter', children: [h('span', { text: Lang.t('gsearch.from') }), from] }),
    h('label', { cls: 'gl-filter', children: [h('span', { text: Lang.t('gsearch.to') }), to] }),
    h('label', { cls: 'gl-filter', children: [h('span', { text: Lang.t('gsearch.folder') }), folderSel] }),
  ] });
  const status = h('div', { cls: 'gl-modal__hint', attrs: { 'aria-live': 'polite' } });
  const list = h('div', { cls: 'gl-results' });
  content.append(input, filters, status, list);

  const dateFmt = new Intl.DateTimeFormat(Lang.locale(), { dateStyle: 'medium' });
  let seq = 0;
  let timer = 0;

  function showIntro(stats) {
    list.replaceChildren();
    status.textContent = '';
    const lines = [Lang.t('gsearch.intro')];
    if (stats && stats.archived === 0) lines.push(Lang.t('gsearch.empty.archive'));
    else if (stats && stats.chats < stats.archived) lines.push(Lang.t('gsearch.index.partial', { indexed: stats.chats, total: stats.archived }));
    for (const t of lines) list.appendChild(h('p', { cls: 'gl-modal__hint', text: t }));
  }

  async function run() {
    const q = input.value.trim();
    const mine = ++seq;
    if (!q) {
      try {
        showIntro(await ArchiveClient.indexStats());
      } catch {
        showIntro(null);
      }
      return;
    }
    status.textContent = Lang.t('gsearch.searching');
    try {
      const ids = folderSel.value ? chatsInFolder(folderSel.value, { folders: Store.get('folders'), assignments: Store.get('assignments') }) : null;
      const res = await ArchiveClient.search({ query: q, ids, from: dayStart(from.value), to: dayEnd(to.value) });
      if (mine !== seq) return; // a newer keystroke superseded this answer
      status.textContent = res.results.length
        ? Lang.t(res.truncated ? 'gsearch.count.truncated' : 'gsearch.count', { n: res.results.length, total: res.total })
        : Lang.t('gsearch.none');
      list.replaceChildren(
        ...res.results.map((r) => {
          const card = h('button', { cls: 'gl-result', attrs: { type: 'button' } });
          card.append(
            highlighted('div', 'gl-result__title', r.title, r.titleRanges),
            h('div', { cls: 'gl-result__meta', text: `${dateFmt.format(new Date(r.at))} · ${Lang.t('gsearch.messages', { n: r.messages })}` }),
            ...r.snippets.map((s) => {
              const row = h('div', { cls: 'gl-result__snip' });
              row.append(h('span', { cls: 'gl-result__role', text: s.role === 'user' ? Lang.t('pdf.you') : '·' }));
              const body = highlighted('span', '', s.text, s.ranges);
              if (s.cutStart) body.prepend('… ');
              if (s.cutEnd) body.append(' …');
              row.append(body);
              return row;
            }),
          );
          card.addEventListener('click', () => {
            if (!openResult(r)) status.textContent = Lang.t('gsearch.cannotOpen');
          });
          return card;
        }),
      );
    } catch (err) {
      if (mine !== seq) return;
      log.warn('search failed', err);
      status.textContent = Lang.t('gsearch.error');
    }
  }

  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(run, 180);
  };
  for (const el of [input, from, to, folderSel]) el.addEventListener(el === input ? 'input' : 'change', later);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      list.querySelector('.gl-result')?.focus();
    }
  });
  list.addEventListener('keydown', (e) => {
    const cards = [...list.querySelectorAll('.gl-result')];
    const i = cards.indexOf(document.activeElement);
    if (i < 0 || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault();
    if (e.key === 'ArrowUp' && i === 0) input.focus();
    else cards[Math.min(cards.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))].focus();
  });
  run();
}
