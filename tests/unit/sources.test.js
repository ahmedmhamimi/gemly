import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window ??= globalThis;
globalThis.document ??= { addEventListener() {}, removeEventListener() {}, documentElement: {}, querySelectorAll: () => [] };
globalThis.chrome ??= { runtime: { id: 'test' } };
const { mergeSources, chatsInFolder } = await import('../../src/content/features/backup/sources.js');

test('mergeSources: sidebar wins, archive-only chats are flagged, folder-only chats listed by cached title', () => {
  const out = mergeSources({
    sidebar: [{ id: 'a', title: 'Live A', path: '/app/a' }],
    archived: [{ id: 'a', title: 'Old A', path: '/app/a' }, { id: 'b', title: 'Saved B', path: '/app/b' }],
    assignments: { a: 'f1', c: 'f1', gone: 'f2' },
    convMeta: { c: { title: 'Cached C', path: '/app/c' } },
  });
  const by = Object.fromEntries(out.map((s) => [s.id, s]));
  assert.deepEqual([by.a.title, by.a.sidebar, by.a.archived, by.a.folderId], ['Live A', true, true, 'f1']);
  assert.deepEqual([by.b.sidebar, by.b.archived, by.b.folderId], [false, true, null]);
  assert.deepEqual([by.c.title, by.c.sidebar, by.c.archived], ['Cached C', false, false]);
  assert.equal(by.gone, undefined, 'assignment without any data is not listed');
});

test('mergeSources: empty title falls back to a short id', () => {
  assert.equal(mergeSources({ sidebar: [{ id: 'abcdef123456', title: '', path: null }], archived: [], assignments: {} })[0].title, 'abcdef12');
});

test('chatsInFolder includes subfolders', () => {
  const folders = [{ id: 'f1' }, { id: 'f2', parentId: 'f1' }, { id: 'f3' }];
  assert.deepEqual(chatsInFolder('f1', { folders, assignments: { a: 'f1', b: 'f2', c: 'f3', d: 'zz' } }).sort(), ['a', 'b']);
});
