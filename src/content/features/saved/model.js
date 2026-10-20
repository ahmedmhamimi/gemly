/**
 * Saved items: starred messages (bookmarks, which gain an optional note) and text
 * highlights with notes. Everything is local (the Store); exports and the Saved
 * panel read from here.
 */
import { cleanNote } from '../../core/schema.js';
import { Store } from '../../core/store.js';
import { uid } from '../../util/text.js';

export const LIMITS = Object.freeze({ highlightsPerChat: 200, quote: 600 });

export const highlightsOf = (convId) => (convId ? Store.get('highlights')[convId] || [] : []);
export const bookmarksOf = (convId) => (convId ? Store.get('bookmarks')[convId] || [] : []);

/** @returns {object|null} the new highlight, or null (empty quote / chat full) */
export function addHighlight(convId, { key, quote, occ = 0, note = '' }) {
  const q = String(quote ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.quote);
  if (!convId || !key || !q) return null;
  const existing = highlightsOf(convId);
  const dup = existing.find((h) => h.key === key && h.quote === q && h.occ === occ);
  if (dup) return dup;
  if (existing.length >= LIMITS.highlightsPerChat) return null;
  const h = { id: uid('h'), key, quote: q, occ, ...(cleanNote(note) ? { note: cleanNote(note) } : {}), createdAt: Date.now() };
  Store.update('highlights', (all) => void (all[convId] = [...(all[convId] || []), h]));
  return h;
}

export function removeHighlight(convId, id) {
  Store.update('highlights', (all) => {
    const left = (all[convId] || []).filter((h) => h.id !== id);
    if (left.length) all[convId] = left;
    else delete all[convId];
  });
}

/** Set (or clear, with an empty string) the note of a highlight or a bookmark. @returns {boolean} found */
export function setNote(kind, convId, idOrKey, note) {
  const text = cleanNote(note);
  let found = false;
  const apply = (item) => {
    found = true;
    if (text) item.note = text;
    else delete item.note;
  };
  if (kind === 'highlight') Store.update('highlights', (all) => (all[convId] || []).filter((h) => h.id === idOrKey).forEach(apply));
  else Store.update('bookmarks', (all) => (all[convId] || []).filter((b) => b.key === idOrKey).forEach(apply));
  return found;
}

export function removeBookmark(convId, key) {
  Store.update('bookmarks', (all) => {
    const left = (all[convId] || []).filter((b) => b.key !== key);
    if (left.length) all[convId] = left;
    else delete all[convId];
  });
}

/**
 * Everything saved, newest first, for the Saved panel.
 * @param {string|null} onlyConv restrict to one chat
 * @returns {{ type: 'bookmark'|'highlight', convId: string, id: string, key: string, text: string, note: string, at: number, role?: string }[]}
 */
export function listSaved(onlyConv = null) {
  const out = [];
  const ids = onlyConv ? [onlyConv] : new Set([...Object.keys(Store.get('bookmarks')), ...Object.keys(Store.get('highlights'))]);
  for (const convId of ids) {
    for (const b of bookmarksOf(convId)) out.push({ type: 'bookmark', convId, id: b.key, key: b.key, text: b.snippet, note: b.note || '', at: b.addedAt, role: b.role });
    for (const h of highlightsOf(convId)) out.push({ type: 'highlight', convId, id: h.id, key: h.key, text: h.quote, note: h.note || '', at: h.createdAt });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Case-insensitive filter on text and note. Pure. */
export const filterSaved = (items, query) => {
  const q = String(query ?? '').trim().toLowerCase();
  return q ? items.filter((i) => i.text.toLowerCase().includes(q) || i.note.toLowerCase().includes(q)) : items;
};

/**
 * What exports carry for a chat: starred messages and highlights with their notes.
 * @returns {{ bookmarks: { snippet: string, note?: string, role: string }[], highlights: { quote: string, note?: string }[] } | null}
 */
export function savedForChat(convId) {
  const bookmarks = bookmarksOf(convId).map((b) => ({ snippet: b.snippet, role: b.role, ...(b.note ? { note: b.note } : {}) }));
  const highlights = highlightsOf(convId).map((h) => ({ quote: h.quote, ...(h.note ? { note: h.note } : {}) }));
  return bookmarks.length || highlights.length ? { bookmarks, highlights } : null;
}

/**
 * A readable title for a chat id: the sidebar's, else what folders/archive cached, else a short id.
 * @param {{ sidebar?: {id: string, title: string}[], convMeta?: Record<string, {title?: string}>, archived?: Record<string, {title?: string}> }} src
 */
export function chatTitleFor(id, { sidebar = [], convMeta = {}, archived = {} } = {}) {
  return sidebar.find((c) => c.id === id)?.title || convMeta[id]?.title || archived[id]?.title || `#${id.slice(0, 8)}`;
}

