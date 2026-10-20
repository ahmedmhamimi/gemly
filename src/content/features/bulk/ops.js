/**
 * Bulk operations on chats (pure of the DOM; everything goes through the Store).
 * Each operation is ONE Store.update per entry, however many chats are involved,
 * so selecting 200 chats is a handful of storage writes, not hundreds.
 */
import { cleanTag } from '../../core/schema.js';
import { Store } from '../../core/store.js';
import { cleanLabel } from '../../util/text.js';

const TAGS_PER_CHAT = 10;

/** "work, #ideas\nQ4" -> ['work', 'ideas', 'Q4']  (unique case-insensitively, max 10). */
export function parseTags(input) {
  const seen = new Set();
  const out = [];
  for (const part of String(input ?? '').split(/[,\n;]+/)) {
    const t = cleanTag(part.replace(/^#+/, ''));
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= TAGS_PER_CHAT) break;
  }
  return out;
}

/** @param {string[]} ids @param {Record<string, {title?: string, path?: string|null}>} meta */
export function moveChats(ids, folderId, meta = {}) {
  if (folderId && !Store.get('folders').some((f) => f.id === folderId)) return 0;
  Store.update('assignments', (m) => {
    for (const id of ids) {
      if (folderId) m[id] = folderId;
      else delete m[id];
    }
  });
  Store.update('convMeta', (m) => {
    for (const id of ids) {
      if (!folderId) delete m[id];
      else {
        const prev = m[id] || {};
        m[id] = { title: cleanLabel(meta[id]?.title, 200) || prev.title || '', path: meta[id]?.path || prev.path || null };
      }
    }
  });
  if (folderId) Store.update('folderState', (s) => void (s[folderId] = true));
  return ids.length;
}

export function addTags(ids, tags) {
  const add = parseTags(tags.join(','));
  if (!add.length) return 0;
  Store.update('chatTags', (m) => {
    for (const id of ids) {
      const cur = m[id] || [];
      const have = new Set(cur.map((t) => t.toLowerCase()));
      const next = [...cur, ...add.filter((t) => !have.has(t.toLowerCase()))].slice(0, TAGS_PER_CHAT);
      if (next.length) m[id] = next;
    }
  });
  return ids.length;
}

export function removeTags(ids, tags) {
  const drop = new Set(tags.map((t) => t.toLowerCase()));
  Store.update('chatTags', (m) => {
    for (const id of ids) {
      if (!m[id]) continue;
      const next = m[id].filter((t) => !drop.has(t.toLowerCase()));
      if (next.length) m[id] = next;
      else delete m[id];
    }
  });
  return ids.length;
}

/** Tags in use, most used first: [{ tag, count }]. */
export function tagCounts(ids = null) {
  const counts = new Map();
  const tags = Store.get('chatTags');
  for (const id of ids || Object.keys(tags)) {
    for (const t of tags[id] || []) {
      const k = t.toLowerCase();
      const cur = counts.get(k) || { tag: t, count: 0 };
      cur.count++;
      counts.set(k, cur);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Hide chats inside the extension (nothing changes in Gemini). */
export function archiveChats(ids, meta = {}, now = Date.now()) {
  Store.update('archivedChats', (m) => {
    for (const id of ids) {
      m[id] = { at: now, title: cleanLabel(meta[id]?.title, 200) || m[id]?.title || '', path: meta[id]?.path || m[id]?.path || null };
    }
  });
  return ids.length;
}

export function unarchiveChats(ids) {
  Store.update('archivedChats', (m) => ids.forEach((id) => delete m[id]));
  return ids.length;
}

/** After chats were really deleted in Gemini: drop everything the extension kept about them. */
export function forgetChats(ids) {
  const gone = new Set(ids);
  for (const name of ['assignments', 'convMeta', 'chatTags', 'archivedChats']) {
    if (ids.some((id) => id in Store.get(name))) Store.update(name, (m) => gone.forEach((id) => delete m[id]));
  }
}

/** Does a chat match a sidebar filter term (title or any tag)? `term` is already case-folded. */
export function matchesFilter(title, tags, term, fold) {
  if (!term) return true;
  return fold(title).includes(term) || (tags || []).some((t) => fold(t).includes(term));
}

