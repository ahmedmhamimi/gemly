/**
 * What can be exported: the chats Gemini's sidebar shows, plus the chats saved in
 * the extension's archive (earlier captures or a restored backup).
 */
import { ArchiveClient } from '../../core/archive-client.js';
import { Store } from '../../core/store.js';
import { GeminiHost as host } from '../../host/gemini.js';
import { descendantIds } from '../folders/model.js';

/**
 * Pure merge. Sidebar entries win for title/path (they are live).
 * @returns {{ id: string, title: string, path: string|null, sidebar: boolean, archived: boolean, folderId: string|null }[]}
 */
export function mergeSources({ sidebar, archived, assignments, convMeta = {} }) {
  const map = new Map();
  for (const s of sidebar) map.set(s.id, { id: s.id, title: s.title, path: s.path, sidebar: true, archived: false });
  for (const a of archived) {
    const cur = map.get(a.id);
    if (cur) cur.archived = true;
    else map.set(a.id, { id: a.id, title: a.title, path: a.path, sidebar: false, archived: true });
  }
  // Chats that only exist in a folder (their sidebar row is not loaded) can still be listed by title.
  for (const [id, fid] of Object.entries(assignments)) {
    if (!map.has(id) && convMeta[id]) map.set(id, { id, title: convMeta[id].title || id, path: convMeta[id].path, sidebar: false, archived: false });
    if (map.has(id)) map.get(id).folderId = fid;
  }
  return [...map.values()].map((s) => ({ folderId: null, ...s, title: s.title || id8(s.id) }));
}
const id8 = (id) => id.slice(0, 8);

/** Ids of a folder and everything under it. Pure. */
export function chatsInFolder(folderId, { folders, assignments }) {
  const ids = descendantIds(folders, folderId);
  ids.add(folderId);
  return Object.keys(assignments).filter((c) => ids.has(assignments[c]));
}

/** Gather live + archived sources (the archive may be unavailable: then only the sidebar is listed). */
export async function listSources() {
  let archived = [];
  try {
    archived = await ArchiveClient.list();
  } catch {
    /* worker not reachable: continue with what the page shows */
  }
  return mergeSources({ sidebar: host.chatList(), archived, assignments: Store.get('assignments'), convMeta: Store.get('convMeta') });
}
