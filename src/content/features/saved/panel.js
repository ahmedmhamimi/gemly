/**
 * The Saved panel: starred messages and highlights, for this chat or all chats,
 * with search, inline notes, "go to" and remove.
 */
import { IDS } from '../../core/config.js';
import { bus } from '../../core/events.js';
import { Store } from '../../core/store.js';
import { GeminiHost as host } from '../../host/gemini.js';
import { Lang } from '../../i18n/index.js';
import { icon } from '../../ui/icons.js';
import { Modal } from '../../ui/modal.js';
import { Toast } from '../../ui/toast.js';
import { h } from '../../util/dom.js';
import { chatTitleFor, filterSaved, listSaved, removeBookmark, removeHighlight, setNote } from './model.js';
import { scrollToKey } from './painter.js';
import { state } from './state.js';

const RENDER_LIMIT = 200;

function goTo(item) {
  Modal.closeAll();
  if (item.convId === host.currentConversationId()) {
    if (!state.scan || !scrollToKey(state.scan, item.key)) Toast.show(Lang.t('saved.notLoaded'));
    return;
  }
  if (host.openConversation(item.convId)) return;
  location.assign(`/app/${encodeURIComponent(item.convId)}`); // not in the sidebar: open by address
}

export function openSavedPanel({ tab } = {}) {
  const here = host.currentConversationId();
  const view = { tab: tab || (here ? 'chat' : 'all'), query: '' };
  const content = h('div');
  Modal.open({ title: Lang.t('saved.title'), content, width: 560, id: IDS.savedDialog, onClose: () => off() });

  const tabs = h('div', { cls: 'gl-tabs', attrs: { role: 'tablist' } });
  const search = h('input', { cls: 'gl-input', attrs: { type: 'search', placeholder: Lang.t('saved.search'), 'aria-label': Lang.t('saved.search') } });
  search.addEventListener('keydown', (e) => e.stopPropagation());
  const list = h('div', { cls: 'gl-saved-list' });
  content.append(tabs, search, list);

  const fmt = new Intl.DateTimeFormat(Lang.locale(), { dateStyle: 'medium' });

  function drawTabs() {
    tabs.replaceChildren(
      ...[['chat', 'saved.tab.chat'], ['all', 'saved.tab.all']].map(([id, key]) => {
        const b = h('button', { cls: 'gl-tab', attrs: { type: 'button', role: 'tab', 'aria-selected': String(view.tab === id) }, text: Lang.t(key) });
        b.disabled = id === 'chat' && !here;
        b.addEventListener('click', () => {
          view.tab = id;
          draw();
        });
        return b;
      }),
    );
  }

  function row(item, showChat, sources) {
    const el = h('div', { cls: 'gl-saved-item' });
    const head = h('div', { cls: 'gl-saved-item__text', attrs: { dir: 'auto' } });
    head.innerHTML = item.type === 'bookmark' ? icon('star', 13) : '<span class="gl-saved-item__bar"></span>';
    head.append(h('span', { text: item.type === 'bookmark' ? ` ${item.text}` : ` “${item.text}”` }));
    el.appendChild(head);
    const noteBox = h('div');
    const drawNote = () => {
      noteBox.replaceChildren(...(item.note ? [h('div', { cls: 'gl-saved-item__note', text: item.note, attrs: { dir: 'auto' } })] : []));
    };
    drawNote();
    el.appendChild(noteBox);
    const meta = [showChat ? chatTitleFor(item.convId, sources) : null, item.at ? fmt.format(new Date(item.at)) : null].filter(Boolean).join(' · ');
    if (meta) el.appendChild(h('div', { cls: 'gl-saved-item__meta', text: meta, attrs: { dir: 'auto' } }));

    const act = h('div', { cls: 'gl-saved-item__actions' });
    const btn = (label, fn, cls = 'gl-btn gl-btn--small') => {
      const b = h('button', { cls, attrs: { type: 'button' }, text: label });
      b.addEventListener('click', fn);
      return b;
    };
    const edit = () => {
      const area = h('textarea', { cls: 'gl-input', attrs: { rows: '3', maxlength: '500', placeholder: Lang.t('saved.note.placeholder'), 'aria-label': Lang.t('saved.note') } });
      area.value = item.note;
      area.addEventListener('keydown', (e) => e.stopPropagation());
      const save = btn(Lang.t('prompts.form.save'), () => {
        setNote(item.type, item.convId, item.id, area.value);
        // the store event redraws the list
      }, 'gl-btn gl-btn--small gl-btn--primary');
      const cancel = btn(Lang.t('prompts.form.cancel'), draw);
      noteBox.replaceChildren(area, h('div', { cls: 'gl-saved-item__actions', children: [cancel, save] }));
      area.focus();
    };
    act.append(
      btn(Lang.t('saved.goto'), () => goTo(item)),
      btn(Lang.t(item.note ? 'saved.note.edit' : 'saved.note.add'), edit),
      btn(Lang.t('saved.remove'), () => (item.type === 'bookmark' ? removeBookmark(item.convId, item.id) : removeHighlight(item.convId, item.id)), 'gl-btn gl-btn--small gl-btn--danger'),
    );
    el.appendChild(act);
    return el;
  }

  function draw() {
    drawTabs();
    const sources = { sidebar: host.chatList(), convMeta: Store.get('convMeta'), archived: Store.get('archivedChats') };
    const all = filterSaved(listSaved(view.tab === 'chat' ? here : null), view.query);
    const shown = all.slice(0, RENDER_LIMIT);
    const nodes = shown.map((it) => row(it, view.tab === 'all', sources));
    if (!nodes.length) nodes.push(h('p', { cls: 'gl-modal__hint', text: Lang.t(view.query ? 'saved.none.search' : 'saved.none') }));
    else if (all.length > shown.length) nodes.push(h('p', { cls: 'gl-modal__hint', text: Lang.t('picker.more', { n: all.length - shown.length }) }));
    list.replaceChildren(...nodes);
  }

  search.addEventListener('input', () => {
    view.query = search.value;
    draw();
  });
  const off = bus.on('store', ({ names }) => {
    if (names.some((n) => n === 'bookmarks' || n === 'highlights')) draw();
  });
  draw();
}
