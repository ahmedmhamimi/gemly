import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window ??= globalThis;
globalThis.document ??= { addEventListener() {}, removeEventListener() {}, documentElement: {}, querySelectorAll: () => [] };
globalThis.chrome ??= { runtime: { id: 't' } };
const { deleteChats } = await import('../../src/content/features/bulk/delete-job.js');
const { isDeleteLabel } = await import('../../src/content/host/gemini.js');

const T = { stepMs: 60, goneMs: 80, intervalMs: 2, betweenMs: 1 };
const items = (...ids) => ids.map((id) => ({ id, title: `Chat ${id}` }));

/** A scriptable fake of Gemini's sidebar + menu + dialog. */
function fakeHost({ chats, noMenuFor = [], noDeleteItem = false, noConfirm = false, stuck = [], log = [] } = {}) {
  const present = new Set(chats);
  let menuOpenFor = null, dialogFor = null;
  const btn = (fn) => ({ click: fn });
  return {
    log,
    present,
    linkFor: (id) => (present.has(id) ? { id } : null),
    chatMenuButton: (link) => (noMenuFor.includes(link.id) ? null : btn(() => { menuOpenFor = link.id; log.push(`menu ${link.id}`); })),
    deleteMenuItem: () => (menuOpenFor && !noDeleteItem ? btn(() => { dialogFor = menuOpenFor; menuOpenFor = null; log.push(`delete ${dialogFor}`); }) : null),
    confirmDeleteButton: () => (dialogFor && !noConfirm ? btn(() => { log.push(`confirm ${dialogFor}`); if (!stuck.includes(dialogFor)) present.delete(dialogFor); dialogFor = null; }) : null),
    isChatGone: (id) => !present.has(id),
    closeOverlays: () => { menuOpenFor = dialogFor = null; log.push('close'); },
  };
}

test('deletes every chat through menu -> delete -> confirm and reports progress', async () => {
  const host = fakeHost({ chats: ['a', 'b', 'c'] });
  const ev = [];
  const r = await deleteChats(items('a', 'b', 'c'), { host, timing: T, onProgress: (p) => ev.push(`${p.state}:${p.item.id}`) });
  assert.deepEqual(r.deleted, ['a', 'b', 'c']);
  assert.deepEqual([r.failures, r.cancelled, r.fatal], [[], false, null]);
  assert.deepEqual(host.log.filter((l) => l.startsWith('confirm')), ['confirm a', 'confirm b', 'confirm c']);
  assert.deepEqual(ev.filter((e) => e.startsWith('ok')), ['ok:a', 'ok:b', 'ok:c']);
});

test('a chat whose row is not loaded is a per-item failure and the batch goes on', async () => {
  const host = fakeHost({ chats: ['a', 'c'] });
  const r = await deleteChats(items('a', 'ghost', 'c'), { host, timing: T });
  assert.deepEqual(r.deleted, ['a', 'c']);
  assert.deepEqual(r.failures, [{ id: 'ghost', title: 'Chat ghost', code: 'not-in-sidebar' }]);
});

test('"still there after confirming" is a per-item failure, never counted as deleted, batch continues', async () => {
  const host = fakeHost({ chats: ['a', 'b'], stuck: ['a'] });
  const r = await deleteChats(items('a', 'b'), { host, timing: T });
  assert.deepEqual(r.deleted, ['b']);
  assert.deepEqual(r.failures.map((f) => [f.id, f.code]), [['a', 'still-present']]);
});

test('no "..." button: batch STOPS at once (selector problem), nothing is clicked further', async () => {
  const host = fakeHost({ chats: ['a', 'b'], noMenuFor: ['a'] });
  const r = await deleteChats(items('a', 'b'), { host, timing: T });
  assert.equal(r.fatal, 'no-menu-button');
  assert.deepEqual(r.deleted, []);
  assert.equal(host.log.some((l) => l.includes(' b')), false, 'the second chat is never touched');
});

test('unrecognised menu / dialog: overlays are closed and the batch stops', async () => {
  const h1 = fakeHost({ chats: ['a', 'b'], noDeleteItem: true });
  const r1 = await deleteChats(items('a', 'b'), { host: h1, timing: T });
  assert.equal(r1.fatal, 'no-delete-item');
  assert.ok(h1.log.includes('close'));
  assert.equal(h1.present.size, 2, 'nothing was deleted');

  const h2 = fakeHost({ chats: ['a', 'b'], noConfirm: true });
  const r2 = await deleteChats(items('a', 'b'), { host: h2, timing: T });
  assert.equal(r2.fatal, 'no-confirm');
  assert.ok(h2.log.includes('close'));
  assert.equal(h2.present.size, 2);
});

test('fatal after some successes keeps what was already deleted', async () => {
  const host = fakeHost({ chats: ['a', 'b', 'c'], noMenuFor: ['b'] });
  const r = await deleteChats(items('a', 'b', 'c'), { host, timing: T });
  assert.deepEqual(r.deleted, ['a']);
  assert.equal(r.fatal, 'no-menu-button');
  assert.equal(host.present.has('c'), true);
});

test('cancel stops before the next chat and closes any open overlay', async () => {
  const ac = new AbortController();
  const host = fakeHost({ chats: ['a', 'b', 'c'] });
  const r = await deleteChats(items('a', 'b', 'c'), { host, timing: T, signal: ac.signal, onProgress: (p) => p.state === 'ok' && p.item.id === 'a' && ac.abort() });
  assert.equal(r.cancelled, true);
  assert.deepEqual(r.deleted, ['a']);
  assert.equal(host.present.has('b') && host.present.has('c'), true);
  assert.ok(host.log.includes('close'));
});

test('isDeleteLabel: Delete in many languages, but not long sentences, "Remove" or other actions', () => {
  for (const ok of ['Delete', ' delete ', 'Удалить', '删除', 'حذف', 'Supprimer', 'Eliminar', 'Löschen', '削除', '삭제']) assert.equal(isDeleteLabel(ok), true, ok);
  for (const no of ['Remove', 'Rename', 'Pin', 'Cancel', 'Cancelar', '', 'Delete all of your activity and data permanently from every Google service']) assert.equal(isDeleteLabel(no), false, no);
  assert.equal(isDeleteLabel('Delete chat', 8), false, 'length limit applies');
});
