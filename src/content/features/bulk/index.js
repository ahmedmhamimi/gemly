/**
 * Bulk chat management in Gemini's sidebar: multi-select chats, then move them
 * to a folder, tag, archive (hidden by this extension only) or delete.
 * Delete is its own feature id ('bulk-delete') so it can be switched off alone.
 */
import { IDS } from '../../core/config.js';
import { bus } from '../../core/events.js';
import { Features } from '../../core/feature-registry.js';
import { Store } from '../../core/store.js';
import { Lang } from '../../i18n/index.js';
import { icon } from '../../ui/icons.js';
import { Modal } from '../../ui/modal.js';
import { escapeHtml } from '../../util/text.js';
import { mountSidebarBlock } from '../sidebar/blocks.js';
import { archiveSelected, openArchivedDialog, openDeleteDialog, openMoveDialog, openTagDialog } from './dialogs.js';
import { applyRows, clearRows, isRowBox, rowIdOf, visibleChats } from './rows.js';
import { Selection } from './selection.js';

const ORDER = 15;

function iconBtn(name, label, onClick, extra = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `gl-icon-btn ${extra}`.trim();
  b.setAttribute('aria-label', label);
  b.dataset.glTip = label;
  b.innerHTML = icon(name, 16);
  b.addEventListener('click', onClick);
  return b;
}

function textBtn(label, onClick, cls = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `gl-btn gl-btn--small ${cls}`.trim();
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

/** The chats the current selection refers to, with titles (only ones still in the sidebar). */
function selectedItems() {
  const byId = new Map(visibleChats().map((c) => [c.id, c]));
  return Selection.ids().map((id) => ({ id, title: byId.get(id)?.title || id }));
}

function render() {
  const box = document.getElementById(IDS.bulkBar);
  if (!box) return;
  const archivedCount = Object.keys(Store.get('archivedChats')).length;
  const kids = [];
  if (!Selection.on) {
    kids.push(textBtn(Lang.t('bulk.select'), () => Selection.setOn(true)));
    if (archivedCount) kids.push(textBtn(`${Lang.t('bulk.archived')} (${archivedCount})`, openArchivedDialog));
  } else {
    const count = document.createElement('span');
    count.className = 'gl-bulkbar__count';
    count.setAttribute('aria-live', 'polite');
    count.innerHTML = escapeHtml(Lang.t('bulk.selected', { n: Selection.size }));
    const none = Selection.size === 0;
    const acts = [
      iconBtn('checklist', Lang.t('bulk.selectAll'), () => Selection.set(visibleChats().map((c) => c.id))),
      iconBtn('folder', Lang.t('bulk.action.folder'), () => Selection.size && openMoveDialog(Selection.ids())),
      iconBtn('tag', Lang.t('bulk.action.tag'), () => Selection.size && openTagDialog(Selection.ids())),
      iconBtn('archive', Lang.t('bulk.action.archive'), () => Selection.size && archiveSelected(Selection.ids())),
    ];
    if (Features.isEnabled('bulk-delete')) {
      acts.push(iconBtn('trash', Lang.t('bulk.action.delete'), () => Selection.size && openDeleteDialog(selectedItems()), 'gl-icon-btn--danger'));
    }
    acts.slice(1).forEach((b) => (b.disabled = none));
    const done = iconBtn('close', Lang.t('bulk.done'), () => Selection.setOn(false));
    kids.push(count, ...acts, done);
  }
  box.replaceChildren(...kids);
  box.dataset.mode = Selection.on ? 'select' : 'idle';
}

function build() {
  const box = document.createElement('div');
  box.id = IDS.bulkBar;
  box.className = 'gl-ui gl-bulkbar';
  return box;
}

/** @type {import('../../core/app.js').Feature} */
export const bulkManageFeature = {
  id: 'bulk-manage',
  zones: ['sidebar'],
  init(ctx) {
    ctx.onDispose(Selection.subscribe(() => {
      render();
      applyRows();
    }));
    ctx.onDispose(bus.on('store', ({ names }) => {
      if (names.includes('archivedChats') || names.includes('chatTags')) {
        render();
        applyRows();
      }
    }));

    // In selection mode a click on a row selects it instead of opening the chat.
    ctx.listen(
      document,
      'click',
      (e) => {
        if (!Selection.on || Modal.current()) return;
        const id = rowIdOf(e.target);
        if (!id) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) Selection.toggleRange(id, visibleChats().map((c) => c.id));
        else Selection.toggle(id);
      },
      true,
    );
    ctx.listen(document, 'keydown', (e) => {
      if (!Selection.on || Modal.current()) return;
      if (e.key === 'Escape') {
        Selection.setOn(false);
      } else if ((e.key === ' ' || e.key === 'Enter') && isRowBox(e.target)) {
        e.preventDefault();
        const id = rowIdOf(e.target);
        if (id) Selection.toggle(id);
      }
    });
  },
  scan(scan) {
    let box = document.getElementById(IDS.bulkBar);
    if (!box?.isConnected) {
      box = build();
      if (!mountSidebarBlock(box, ORDER)) return;
      render();
    }
    applyRows(scan.links);
  },
  teardown() {
    Selection.setOn(false);
    document.getElementById(IDS.bulkBar)?.remove();
    clearRows();
  },
};

