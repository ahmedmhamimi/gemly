/** Dialogs for bulk chat management: move, tag, archived list, delete. */
import { ArchiveClient } from '../../core/archive-client.js';
import { IDS } from '../../core/config.js';
import { createLogger } from '../../core/log.js';
import { Store } from '../../core/store.js';
import { GeminiHost as host } from '../../host/gemini.js';
import { Lang } from '../../i18n/index.js';
import { Modal } from '../../ui/modal.js';
import { createProgress } from '../../ui/progress.js';
import { Toast } from '../../ui/toast.js';
import { h } from '../../util/dom.js';
import { cleanLabel } from '../../util/text.js';
import { createFolder, flatten } from '../folders/model.js';
import { describeFailures } from '../backup/summary.js';
import { deleteChats } from './delete-job.js';
import { addTags, archiveChats, forgetChats, moveChats, parseTags, removeTags, tagCounts, unarchiveChats } from './ops.js';
import { Selection } from './selection.js';

const log = createLogger('bulk');

const metaFor = (ids) => {
  const live = new Map(host.chatList().map((c) => [c.id, c]));
  return Object.fromEntries(ids.map((id) => [id, { title: live.get(id)?.title || Store.get('archivedChats')[id]?.title, path: live.get(id)?.path }]));
};
const foot = (...children) => h('div', { cls: 'gl-modal__foot', attrs: { style: 'padding:10px 0 0;border:0' }, children });
const btn = (text, cls = 'gl-btn') => h('button', { cls, attrs: { type: 'button' }, text });
const notice = (text, kind = 'info') => h('div', { cls: 'gl-notice', attrs: { 'data-kind': kind }, children: [h('span', { text })] });

// -------------------------------------------------------------------- move

export function openMoveDialog(ids) {
  const content = h('div');
  const modal = Modal.open({ title: Lang.t('bulk.move.title', { n: ids.length }), content, width: 420 });
  const folders = Store.get('folders');
  const sel = h('select', { cls: 'gl-select', attrs: { 'aria-label': Lang.t('bulk.action.folder') } });
  sel.append(h('option', { attrs: { value: '__none' }, text: Lang.t('bulk.move.none') }));
  for (const { folder, depth } of flatten(folders)) sel.append(h('option', { attrs: { value: folder.id }, text: `${'\u00a0\u00a0'.repeat(depth)}${folder.name}` }));
  sel.append(h('option', { attrs: { value: '__new' }, text: Lang.t('bulk.move.new') }));
  sel.value = folders.length ? folders[0].id : '__new';
  const name = h('input', { cls: 'gl-input', attrs: { type: 'text', maxlength: '48', placeholder: Lang.t('bulk.move.name'), 'aria-label': Lang.t('bulk.move.name') } });
  name.addEventListener('keydown', (e) => e.stopPropagation());
  const nameRow = h('div', { cls: 'gl-field', children: [name] });
  const sync = () => (nameRow.hidden = sel.value !== '__new');
  sel.addEventListener('change', sync);
  sync();
  const go = btn(Lang.t('bulk.move.apply'), 'gl-btn gl-btn--primary');
  go.addEventListener('click', () => {
    let target = sel.value;
    if (target === '__new') {
      const label = cleanLabel(name.value, 48);
      if (!label) return name.focus();
      const created = createFolder({ name: label });
      if (!created) return Toast.show(Lang.t('bulk.move.error'));
      target = created.id;
    }
    const n = moveChats(ids, target === '__none' ? null : target, metaFor(ids));
    Selection.clear();
    modal.close();
    Toast.show(Lang.t('bulk.move.done', { n }));
  });
  content.append(h('div', { cls: 'gl-field', children: [sel] }), nameRow, foot(go));
}

// --------------------------------------------------------------------- tags

/** Put a tag into Gemly's sidebar filter box (it matches titles and tags). */
function filterSidebarBy(tag) {
  const input = document.getElementById(IDS.sidebarSearchInput);
  if (!input) return Toast.show(Lang.t('bulk.tag.nofilter'));
  input.value = tag;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  Modal.closeAll();
}

export function openTagDialog(ids) {
  const content = h('div');
  Modal.open({ title: Lang.t('bulk.tag.title', { n: ids.length }), content, width: 440 });
  const input = h('input', { cls: 'gl-input', attrs: { type: 'text', placeholder: Lang.t('bulk.tag.placeholder'), 'aria-label': Lang.t('bulk.tag.add'), autofocus: '' } });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') add.click();
  });
  const add = btn(Lang.t('bulk.tag.addBtn'), 'gl-btn gl-btn--primary');
  const onSel = h('div', { cls: 'gl-chips' });
  const all = h('div', { cls: 'gl-chips' });

  const chip = (tag, count, onClick, removable) => {
    const b = h('button', { cls: 'gl-chip', attrs: { type: 'button', title: removable ? Lang.t('bulk.tag.remove', { tag }) : tag } });
    b.append(h('span', { text: tag }), h('span', { cls: 'gl-chip__n', text: removable ? '×' : String(count) }));
    b.addEventListener('click', onClick);
    return b;
  };
  const draw = () => {
    const mine = tagCounts(ids);
    onSel.replaceChildren(...(mine.length ? mine.map((t) => chip(t.tag, t.count, () => { removeTags(ids, [t.tag]); draw(); }, true)) : [h('span', { cls: 'gl-modal__hint', text: Lang.t('bulk.tag.none') })]));
    all.replaceChildren(...tagCounts().map((t) => chip(t.tag, t.count, () => filterSidebarBy(t.tag), false)));
  };
  add.addEventListener('click', () => {
    const tags = parseTags(input.value);
    if (!tags.length) return input.focus();
    addTags(ids, tags);
    input.value = '';
    Toast.show(Lang.t('bulk.tag.done'));
    draw();
  });
  draw();
  content.append(
    h('div', { cls: 'gl-field', children: [h('label', { text: Lang.t('bulk.tag.add') }), h('div', { attrs: { style: 'display:flex;gap:8px' }, children: [input, add] })] }),
    h('div', { cls: 'gl-modal__section', text: Lang.t('bulk.tag.on') }),
    onSel,
    h('div', { cls: 'gl-modal__section', text: Lang.t('bulk.tag.filter') }),
    all,
  );
}

// ------------------------------------------------------------------ archive

export function archiveSelected(ids) {
  const before = Object.fromEntries(ids.filter((id) => id in Store.get('archivedChats')).map((id) => [id, Store.get('archivedChats')[id]]));
  const n = archiveChats(ids, metaFor(ids));
  Selection.remove(ids);
  Toast.show(Lang.t('bulk.archive.done', { n }), {
    ms: 6000,
    action: {
      label: Lang.t('bulk.archive.undo'),
      onClick: () => {
        const fresh = ids.filter((id) => !(id in before));
        unarchiveChats(fresh);
      },
    },
  });
}

export function openArchivedDialog() {
  const content = h('div');
  Modal.open({ title: Lang.t('bulk.archived.title'), content, width: 480 });
  const list = h('div');
  const show = h('input', { attrs: { type: 'checkbox' } });
  show.checked = Selection.showArchived;
  show.addEventListener('change', () => Selection.setShowArchived(show.checked));
  const fmt = new Intl.DateTimeFormat(Lang.locale(), { dateStyle: 'medium' });
  const unAll = btn(Lang.t('bulk.archived.all'));
  unAll.addEventListener('click', () => {
    unarchiveChats(Object.keys(Store.get('archivedChats')));
    draw();
  });
  function draw() {
    const items = Object.entries(Store.get('archivedChats')).sort((a, b) => b[1].at - a[1].at);
    unAll.hidden = !items.length;
    list.replaceChildren(
      ...(items.length
        ? items.map(([id, m]) => {
            const row = h('div', { cls: 'gl-row' });
            row.append(h('span', { cls: 'gl-row__main', children: [h('span', { cls: 'gl-row__title', text: m.title || id, attrs: { dir: 'auto' } }), h('span', { cls: 'gl-row__sub', attrs: { style: 'display:block' }, text: m.at ? fmt.format(new Date(m.at)) : '' })] }));
            const b = btn(Lang.t('bulk.archived.unarchive'), 'gl-btn gl-btn--small');
            b.addEventListener('click', () => {
              unarchiveChats([id]);
              draw();
            });
            row.append(b);
            return row;
          })
        : [h('p', { cls: 'gl-modal__hint', text: Lang.t('bulk.archived.none') })]),
    );
  }
  draw();
  content.append(
    h('p', { cls: 'gl-modal__hint', text: Lang.t('bulk.archived.hint') }),
    h('label', { cls: 'gl-check', children: [show, h('span', { text: Lang.t('bulk.archived.show') })] }),
    list,
    foot(unAll),
  );
}

// ------------------------------------------------------------------- delete

const FAILURE_TEXT = (code) => {
  const key = `bulk.delete.code.${code}`;
  const t = Lang.t(key);
  return t === key ? code : t;
};

/** @param {{ id: string, title: string }[]} items */
export function openDeleteDialog(items) {
  const content = h('div');
  const modal = Modal.open({ title: Lang.t('bulk.delete.title'), content, width: 480 });
  const { lines, more } = describeFailures(items, 6);

  const understand = h('input', { attrs: { type: 'checkbox' } });
  const copies = h('input', { attrs: { type: 'checkbox' } });
  const go = btn(Lang.t('bulk.delete.go', { n: items.length }), 'gl-btn gl-btn--danger');
  go.disabled = true;
  understand.addEventListener('change', () => (go.disabled = !understand.checked));
  const cancelBtn = btn(Lang.t('backup.cancel'));
  let ac = null; // set while the job runs: Cancel then aborts it instead of closing the dialog
  cancelBtn.addEventListener('click', () => (ac ? ac.abort() : modal.close()));

  const progress = createProgress();
  progress.el.hidden = true;
  const result = h('div');
  const ul = h('ul', { cls: 'gl-list', children: lines.map((t) => h('li', { text: t, attrs: { dir: 'auto' } })) });
  if (more) ul.append(h('li', { text: Lang.t('bulk.delete.more', { n: more }) }));
  const form = h('div', { children: [
    notice(Lang.t('bulk.delete.confirm', { n: items.length }), 'warn'),
    ul,
    h('p', { cls: 'gl-modal__hint', text: Lang.t('bulk.delete.how') }),
    h('label', { cls: 'gl-check', children: [copies, h('span', { text: Lang.t('bulk.delete.copies') })] }),
    h('label', { cls: 'gl-check', attrs: { style: 'margin-top:8px' }, children: [understand, h('span', { text: Lang.t('bulk.delete.understand') })] }),
  ] });
  const actions = foot(cancelBtn, go);
  content.append(form, progress.el, result, actions);

  go.addEventListener('click', async () => {
    ac = new AbortController();
    form.hidden = true;
    progress.el.hidden = false;
    progress.state('running');
    modal.setDismissible(false);
    go.hidden = true;
    try {
      const res = await deleteChats(items, {
        signal: ac.signal,
        onProgress: ({ done, total, item }) => progress.set(done / total, Lang.t('bulk.delete.progress', { done: Math.min(done + 1, total), total, title: item.title })),
      });
      if (res.deleted.length) {
        forgetChats(res.deleted);
        Selection.remove(res.deleted);
        if (copies.checked) {
          try {
            await ArchiveClient.deleteChats(res.deleted);
          } catch (err) {
            log.warn('could not delete saved copies', err);
          }
        }
      }
      const n = res.deleted.length;
      const text = res.fatal
        ? Lang.t(`bulk.delete.fatal.${res.fatal}`)
        : res.cancelled
          ? Lang.t('bulk.delete.cancelled', { n })
          : Lang.t(res.failures.length ? 'bulk.delete.partial' : 'bulk.delete.done', { n, failed: res.failures.length });
      progress.state(res.fatal || res.cancelled || res.failures.length ? 'error' : 'done');
      progress.set(1, '');
      result.append(notice(text, res.fatal || res.failures.length || res.cancelled ? 'warn' : 'info'));
      if (res.failures.length) {
        const f = describeFailures(res.failures);
        const list = h('ul', { cls: 'gl-list', children: res.failures.slice(0, 8).map((x) => h('li', { text: `${x.title || x.id} — ${FAILURE_TEXT(x.code)}`, attrs: { dir: 'auto' } })) });
        if (f.more) list.append(h('li', { text: Lang.t('backup.failed.more', { n: f.more }) }));
        result.append(h('div', { cls: 'gl-modal__hint', text: Lang.t('bulk.delete.failed.title') }), list);
      }
      Toast.show(text);
    } catch (err) {
      log.error('bulk delete crashed', err);
      progress.state('error');
      result.append(notice(Lang.t('backup.error'), 'error'));
    } finally {
      ac = null;
      modal.setDismissible(true);
      cancelBtn.hidden = true;
      const close = btn(Lang.t('modal.close'), 'gl-btn gl-btn--primary');
      close.addEventListener('click', () => modal.close());
      actions.replaceChildren(close);
    }
  });
}
