/**
 * Folder data operations (no DOM). All mutations go through the Store so they
 * are sanitized and persisted; every function is safe to call with stale ids.
 */
import { CONFIG } from '../../core/config.js';
import { Store } from '../../core/store.js';
import { cleanLabel, uid } from '../../util/text.js';

export const childrenOf = (folders, parentId) => {
  const ids = new Set(folders.map((f) => f.id));
  return folders.filter((f) => (parentId ? f.parentId === parentId : !f.parentId || !ids.has(f.parentId)));
};

export function descendantIds(folders, id) {
  const out = new Set();
  const walk = (pid) => {
    for (const f of folders) {
      if (f.parentId === pid && !out.has(f.id)) {
        out.add(f.id);
        walk(f.id);
      }
    }
  };
  walk(id);
  return out;
}

export function depthOf(folders, id) {
  let depth = 0;
  let cur = folders.find((f) => f.id === id);
  while (cur?.parentId && depth < 64) {
    depth++;
    cur = folders.find((f) => f.id === cur.parentId);
  }
  return depth;
}

/** Depth-first flat list with a `depth` field - for menus. */
export function flatten(folders) {
  const out = [];
  const walk = (pid, depth) => {
    for (const f of childrenOf(folders, pid)) {
      out.push({ folder: f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function countIn(folders, assignments, folderId) {
  const ids = descendantIds(folders, folderId);
  ids.add(folderId);
  return Object.values(assignments).filter((fid) => ids.has(fid)).length;
}

/** @returns {object|null} the new folder, or null if nesting would be too deep */
export function createFolder({ name, color, parentId }) {
  const folders = Store.get('folders');
  if (parentId && depthOf(folders, parentId) + 1 >= CONFIG.folders.maxDepth) return null;
  const folder = {
    id: uid('f'),
    name: cleanLabel(name, CONFIG.folders.maxNameLength) || 'Folder',
    color: color || CONFIG.folders.palette[folders.length % CONFIG.folders.palette.length].hex,
    ...(parentId && folders.some((f) => f.id === parentId) ? { parentId } : {}),
  };
  Store.update('folders', (list) => void list.push(folder));
  Store.update('folderState', (s) => {
    s[folder.id] = true;
    if (folder.parentId) s[folder.parentId] = true;
  });
  return folder;
}

export function renameFolder(id, name) {
  const clean = cleanLabel(name, CONFIG.folders.maxNameLength);
  if (!clean) return;
  Store.update('folders', (list) => {
    const f = list.find((x) => x.id === id);
    if (f) f.name = clean;
  });
}

export function recolorFolder(id, color) {
  Store.update('folders', (list) => {
    const f = list.find((x) => x.id === id);
    if (f) f.color = color;
  });
}

/** Deletes a folder and everything under it. Returns a snapshot for undo. */
export function deleteFolder(id) {
  const snapshot = {
    folders: Store.get('folders'),
    assignments: Store.get('assignments'),
    convMeta: Store.get('convMeta'),
    folderState: Store.get('folderState'),
  };
  const doomed = descendantIds(snapshot.folders, id);
  doomed.add(id);
  Store.update('folders', (list) => list.filter((f) => !doomed.has(f.id)));
  const removed = [];
  Store.update('assignments', (m) => {
    for (const convId of Object.keys(m)) {
      if (doomed.has(m[convId])) {
        removed.push(convId);
        delete m[convId];
      }
    }
  });
  Store.update('convMeta', (m) => removed.forEach((c) => delete m[c]));
  Store.update('folderState', (s) => doomed.forEach((d) => delete s[d]));
  return snapshot;
}

export function restoreSnapshot(snapshot) {
  for (const [name, value] of Object.entries(snapshot)) Store.set(name, value);
}

/** folderId = null removes the chat from any folder. */
export function assignChat(convId, folderId, { title, path } = {}) {
  if (!convId) return;
  if (folderId && !Store.get('folders').some((f) => f.id === folderId)) return;
  Store.update('assignments', (m) => {
    if (folderId) m[convId] = folderId;
    else delete m[convId];
  });
  Store.update('convMeta', (m) => {
    if (!folderId) return void delete m[convId];
    const prev = m[convId] || {};
    m[convId] = { title: cleanLabel(title, 200) || prev.title || '', path: path || prev.path || null };
  });
  if (folderId) Store.update('folderState', (s) => void (s[folderId] = true));
}

/** Drop assignments pointing at folders that no longer exist. @returns {boolean} changed */
export function pruneOrphans() {
  const ids = new Set(Store.get('folders').map((f) => f.id));
  const assignments = Store.get('assignments');
  const orphans = Object.keys(assignments).filter((c) => !ids.has(assignments[c]));
  if (!orphans.length) return false;
  Store.update('assignments', (m) => orphans.forEach((c) => delete m[c]));
  Store.update('convMeta', (m) => orphans.forEach((c) => delete m[c]));
  return true;
}
