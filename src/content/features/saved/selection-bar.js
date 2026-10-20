/**
 * A small floating toolbar next to a text selection inside a message:
 * "Highlight" and "Highlight + note". Appears only for selections in chat messages
 * (never in the prompt box or in our own UI), and only in response to a selection.
 */
import { GeminiHost as host } from '../../host/gemini.js';
import { Lang } from '../../i18n/index.js';
import { Modal } from '../../ui/modal.js';
import { Toast } from '../../ui/toast.js';
import { h } from '../../util/dom.js';
import { keyOf } from '../bookmarks/index.js';
import { occurrenceAt } from './locate.js';
import { addHighlight, LIMITS, removeHighlight, setNote } from './model.js';
import { invalidate, paint, textNodesOf } from './painter.js';

let bar = null;

export function hideBar() {
  bar?.remove();
  bar = null;
}

/** What is selected, and where, if it is a highlightable selection inside one message. */
function readSelection(scan) {
  const sel = window.getSelection();
  if (!scan || !sel || !sel.rangeCount || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const el = node.nodeType === 1 ? node : node.parentElement;
  if (!el || el.closest('.gl-ui') || host.editor()?.contains(el)) return null;
  const i = scan.turns.findIndex((t) => t.contains(el));
  if (i < 0) return null;
  const quote = sel.toString().replace(/\s+/g, ' ').trim();
  if (quote.length < 2 || quote.length > LIMITS.quote) return null;
  return { sel, range, i, quote };
}

export function openNoteDialog({ title, note = '', onSave, onRemove }) {
  const content = h('div');
  const area = h('textarea', { cls: 'gl-input', attrs: { rows: '4', maxlength: '500', placeholder: Lang.t('saved.note.placeholder'), 'aria-label': Lang.t('saved.note'), autofocus: '' } });
  area.value = note;
  area.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save.click();
  });
  const save = h('button', { cls: 'gl-btn gl-btn--primary', attrs: { type: 'button' }, text: Lang.t('prompts.form.save') });
  const kids = [save];
  if (onRemove) {
    const rm = h('button', { cls: 'gl-btn gl-btn--danger-ghost', attrs: { type: 'button', style: 'margin-inline-end:auto' }, text: Lang.t('saved.remove') });
    rm.addEventListener('click', () => {
      onRemove();
      modal.close();
    });
    kids.unshift(rm);
  }
  const modal = Modal.open({ title, content, width: 420 });
  save.addEventListener('click', () => {
    onSave(area.value);
    modal.close();
  });
  content.append(area, h('div', { cls: 'gl-modal__foot', attrs: { style: 'padding:16px 0 0;border:0' }, children: kids }));
}

function create(scan, convId, withNote) {
  const s = readSelection(scan);
  if (!s || !convId) return hideBar();
  const turn = scan.turns[s.i];
  const nodes = textNodesOf(turn);
  const startIdx = nodes.indexOf(s.range.startContainer);
  const occ = startIdx >= 0 ? occurrenceAt(nodes.map((n) => n.data), s.quote, startIdx, s.range.startOffset) : 0;
  const hl = addHighlight(convId, { key: keyOf(scan.index, scan.turns, s.i), quote: s.quote, occ });
  s.sel.removeAllRanges();
  hideBar();
  if (!hl) return void Toast.show(Lang.t('saved.full', { max: LIMITS.highlightsPerChat }));
  invalidate();
  paint({ ...scan, generating: false }, convId);
  if (withNote) openNoteDialog({ title: Lang.t('saved.note.add'), note: hl.note || '', onSave: (t) => setNote('highlight', convId, hl.id, t), onRemove: () => removeHighlight(convId, hl.id) });
  else Toast.show(Lang.t('saved.highlighted'));
}

/** Wire the selection toolbar. `get()` returns the latest scan snapshot and the chat id. */
export function initSelectionBar(ctx, get) {
  const show = () => {
    const { scan, convId } = get();
    const s = readSelection(scan);
    if (!s || !convId) return hideBar();
    hideBar();
    const rect = s.range.getBoundingClientRect();
    const mk = (label, withNote) => {
      const b = h('button', { cls: 'gl-btn gl-btn--small', attrs: { type: 'button' }, text: label });
      b.addEventListener('click', () => create(get().scan, get().convId, withNote));
      return b;
    };
    bar = h('div', { cls: 'gl-ui gl-selbar', attrs: { role: 'toolbar' }, children: [mk(Lang.t('saved.highlight'), false), mk(Lang.t('saved.highlight.note'), true)] });
    bar.addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection while clicking
    document.body.appendChild(bar);
    const w = bar.offsetWidth || 220;
    bar.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, rect.left + rect.width / 2 - w / 2))}px`;
    bar.style.top = `${Math.max(8, rect.top - 44)}px`;
  };
  // After the mouse is released / a keyboard selection ends. Never on a timer.
  ctx.listen(document, 'mouseup', (e) => {
    if (e.target?.closest?.('.gl-selbar')) return;
    setTimeout(show, 10);
  });
  ctx.listen(document, 'keyup', (e) => {
    if (e.shiftKey || e.key === 'Shift') setTimeout(show, 10);
  });
  ctx.listen(document, 'selectionchange', () => {
    if (bar && window.getSelection()?.isCollapsed) hideBar();
  });
  ctx.listen(document, 'keydown', (e) => e.key === 'Escape' && hideBar());
  ctx.listen(document, 'scroll', hideBar, true);
}
