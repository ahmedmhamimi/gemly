/**
 * Decorates Gemini's sidebar rows for bulk management: a checkbox in selection
 * mode, and hiding of chats archived inside the extension. Only touches rows
 * through GeminiHost (selectors stay in the host layer) and only with classes /
 * data attributes of its own, so removing it restores the sidebar exactly.
 */
import { Store } from '../../core/store.js';
import { GeminiHost as host } from '../../host/gemini.js';
import { Lang } from '../../i18n/index.js';
import { Selection } from './selection.js';

const ROW_CLASS = 'gl-selectable';
const BOX_CLASS = 'gl-rowcheck';
const ATTR = 'data-gl-conv';

/** Rows of selectable chats in sidebar order, with their ids. Hidden (archived / filtered) rows are skipped. */
export function visibleChats(links = host.sidebarLinks()) {
  const out = [];
  for (const link of links) {
    const id = host.conversationId(link.getAttribute('href'));
    if (!id) continue;
    const row = host.rowFor(link);
    if (row.classList.contains('gl-archived-row') || row.classList.contains('gl-hidden')) continue;
    out.push({ id, title: host.linkTitle(link), path: host.pathOf(link.getAttribute('href')), link, row });
  }
  return out;
}

function ensureBox(row, id) {
  let box = row.querySelector(`:scope > .${BOX_CLASS}`);
  if (!box) {
    box = document.createElement('span');
    box.className = `gl-ui ${BOX_CLASS}`;
    box.setAttribute('role', 'checkbox');
    box.tabIndex = 0;
    box.setAttribute('aria-label', Lang.t('bulk.select.row'));
    row.appendChild(box);
  }
  const on = Selection.has(id);
  box.setAttribute('aria-checked', String(on));
  row.toggleAttribute('data-gl-selected', on);
  return box;
}

/** Apply archive hiding and (in selection mode) checkboxes to the rows. */
export function applyRows(links = host.sidebarLinks()) {
  const archived = Store.get('archivedChats');
  const hideArchived = !Selection.showArchived;
  for (const link of links) {
    const id = host.conversationId(link.getAttribute('href'));
    if (!id) continue;
    const row = host.rowFor(link);
    row.classList.toggle('gl-archived-row', hideArchived && id in archived);
    if (Selection.on && !row.classList.contains('gl-archived-row')) {
      row.classList.add(ROW_CLASS);
      row.setAttribute(ATTR, id);
      ensureBox(row, id);
    } else if (row.classList.contains(ROW_CLASS)) {
      clearRow(row);
    }
  }
}

function clearRow(row) {
  row.classList.remove(ROW_CLASS);
  row.removeAttribute(ATTR);
  row.removeAttribute('data-gl-selected');
  row.querySelector(`:scope > .${BOX_CLASS}`)?.remove();
}

/** Remove everything this module added (feature teardown). */
export function clearRows() {
  document.querySelectorAll(`.${ROW_CLASS}`).forEach(clearRow);
  document.querySelectorAll('.gl-archived-row').forEach((r) => r.classList.remove('gl-archived-row'));
}

/** The chat id of the row an event happened in, or null. */
export const rowIdOf = (target) => target?.closest?.(`.${ROW_CLASS}`)?.getAttribute(ATTR) ?? null;
export const isRowBox = (target) => !!target?.closest?.(`.${BOX_CLASS}`);
