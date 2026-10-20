import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeArchived, sanitizeChatTags } from '../../src/content/core/schema.js';

globalThis.window ??= globalThis;
globalThis.document ??= { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
globalThis.window.addEventListener ??= () => {};
globalThis.window.removeEventListener ??= () => {};
const mem = {};
globalThis.chrome = { runtime: { id: 't' }, storage: { local: {
  get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => k in mem).map((k) => [k, structuredClone(mem[k])])),
  set: async (o) => Object.assign(mem, structuredClone(o)), remove: async () => {} }, onChanged: { addListener() {}, removeListener() {} } } };
const { Store } = await import('../../src/content/core/store.js');
const ops = await import('../../src/content/features/bulk/ops.js');

test.beforeEach(async () => {
  Store.dispose();
  for (const k of Object.keys(mem)) delete mem[k];
  mem['gemly-folders-v1'] = [{ id: 'f1', name: 'Work', color: '#4f7cff' }];
  await Store.load();
});

test('parseTags: separators, # prefix, case-insensitive de-dup, length and count caps', () => {
  assert.deepEqual(ops.parseTags('work, #Ideas\nwork; Q4 , '), ['work', 'Ideas', 'Q4']);
  assert.deepEqual(ops.parseTags(''), []);
  assert.deepEqual(ops.parseTags(null), []);
  assert.equal(ops.parseTags('x'.repeat(100))[0].length, 30);
  assert.equal(ops.parseTags(Array.from({ length: 30 }, (_, i) => `t${i}`).join(',')).length, 10);
});

test('sanitizers: tags and archived entries are cleaned, bad ids/shapes dropped', () => {
  assert.deepEqual(sanitizeChatTags({ 'a b': ['x'], ok1: ['Work', 'work', ' ', 5, 'a,b'], ok2: [], ok3: 'no', ok4: ['#x'] }), { ok1: ['Work', 'a b'], ok4: ['x'] });
  assert.deepEqual(sanitizeChatTags(null), {});
  assert.deepEqual(sanitizeArchived({ ok1: { at: 5, title: 'T', path: '//evil' }, 'bad id': {}, ok2: 'x' }), { ok1: { at: 5, title: 'T', path: null } });
});

test('moveChats: assigns many chats in one go, keeps title/path metadata, "no folder" clears, unknown folder is refused', () => {
  assert.equal(ops.moveChats(['c1', 'c2'], 'f1', { c1: { title: 'One', path: '/app/c1' } }), 2);
  assert.deepEqual(Store.get('assignments'), { c1: 'f1', c2: 'f1' });
  assert.deepEqual(Store.get('convMeta').c1, { title: 'One', path: '/app/c1' });
  assert.equal(Store.get('folderState').f1, true);
  assert.equal(ops.moveChats(['c1'], 'nope'), 0);
  assert.equal(Store.get('assignments').c1, 'f1', 'unchanged');
  ops.moveChats(['c1'], null);
  assert.deepEqual(Store.get('assignments'), { c2: 'f1' });
  assert.equal(Store.get('convMeta').c1, undefined);
});

test('addTags / removeTags / tagCounts', () => {
  ops.addTags(['c1', 'c2'], ['Work', 'ideas']);
  ops.addTags(['c2'], ['WORK', 'q4']);
  assert.deepEqual(Store.get('chatTags'), { c1: ['Work', 'ideas'], c2: ['Work', 'ideas', 'q4'] });
  assert.deepEqual(ops.tagCounts().map((t) => [t.tag.toLowerCase(), t.count]), [['ideas', 2], ['work', 2], ['q4', 1]]);
  assert.deepEqual(ops.tagCounts(['c2']).length, 3);
  ops.removeTags(['c1', 'c2', 'ghost'], ['WORK', 'ideas']);
  assert.deepEqual(Store.get('chatTags'), { c2: ['q4'] });
  assert.equal(ops.addTags(['c1'], ['  ', ',']), 0, 'nothing usable -> no write');
});

test('archive / unarchive keep title and path for the archived list', () => {
  ops.archiveChats(['c1'], { c1: { title: 'Old plan', path: '/app/c1' } }, 123);
  assert.deepEqual(Store.get('archivedChats').c1, { at: 123, title: 'Old plan', path: '/app/c1' });
  ops.archiveChats(['c1'], {}, 456);
  assert.equal(Store.get('archivedChats').c1.title, 'Old plan', 'a re-archive without metadata keeps what we knew');
  ops.unarchiveChats(['c1', 'zzz']);
  assert.deepEqual(Store.get('archivedChats'), {});
});

test('forgetChats removes every trace of deleted chats and leaves others alone', () => {
  ops.moveChats(['c1', 'c2'], 'f1', {});
  ops.addTags(['c1', 'c2'], ['x']);
  ops.archiveChats(['c1'], {});
  ops.forgetChats(['c1']);
  assert.deepEqual(Object.keys(Store.get('assignments')), ['c2']);
  assert.deepEqual(Object.keys(Store.get('chatTags')), ['c2']);
  assert.deepEqual(Store.get('archivedChats'), {});
  assert.equal(Store.get('convMeta').c1, undefined);
  ops.forgetChats(['never-existed']); // no throw, no extra writes
});

test('matchesFilter: title or tag, empty term matches everything', () => {
  const fold = (s) => s.toLowerCase();
  assert.equal(ops.matchesFilter('Budget plan', ['finance'], 'fin', fold), true);
  assert.equal(ops.matchesFilter('Budget plan', ['finance'], 'plan', fold), true);
  assert.equal(ops.matchesFilter('Budget plan', [], 'xyz', fold), false);
  assert.equal(ops.matchesFilter('x', undefined, '', fold), true);
});
