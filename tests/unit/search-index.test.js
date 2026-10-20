import test from 'node:test';
import assert from 'node:assert/strict';
import { Archive, MemoryBackend } from '../../src/background/archive.js';
import { SEARCH_LIMITS } from '../../src/background/search-index.js';
import { makeRecord } from '../../src/content/features/export/serialize/record.js';

const rec = (id, title, msgs, at = 1000) =>
  makeRecord({ id, title, path: `/app/${id}`, capturedAt: at, conversation: { messages: msgs.map(([role, content]) => ({ role, content, isHTML: false })) } });
const mk = () => new Archive(new MemoryBackend());
const titles = (r) => r.results.map((x) => x.title);

async function seeded() {
  const a = mk();
  await a.putChats([
    rec('react1', 'React hooks guide', [['user', 'How do useEffect hooks work?'], ['assistant', 'useEffect runs after render. Hooks must be called at the top level.']], 3000),
    rec('py0001', 'Python sorting', [['user', 'sort a list of dicts by key'], ['assistant', 'Use sorted(items, key=lambda d: d["k"]).']], 2000),
    rec('cafe01', 'Voyage à Paris', [['user', 'Un café près de la tour Eiffel ?'], ['assistant', 'Essayez le café de Flore.']], 1000),
    rec('zh0001', '机器学习笔记', [['user', '什么是机器学习?'], ['assistant', '机器学习是人工智能的一个分支。']], 500),
  ]);
  return a;
}

test('indexing on save; stats reflect it', async () => {
  const a = await seeded();
  const s = await a.indexStats();
  assert.deepEqual([s.chats, s.archived], [4, 4]);
  assert.ok(s.tokens > 20);
});

test('AND across terms, ranked; title matches outrank body matches', async () => {
  const a = await seeded();
  assert.deepEqual(titles(await a.search({ query: 'react hooks' })), ['React hooks guide']);
  assert.deepEqual(titles(await a.search({ query: 'hooks python' })), [], 'AND: no chat has both');
  const r = await a.search({ query: 'sorted' });
  assert.deepEqual(titles(r), ['Python sorting']);
  assert.equal(r.total, 1);
});

test('prefix on the LAST term only (type-ahead)', async () => {
  const a = await seeded();
  assert.deepEqual(titles(await a.search({ query: 'use' })).sort(), ['Python sorting', 'React hooks guide'], '"use" is a word in one chat and a prefix of "useEffect" in the other');
  assert.deepEqual(titles(await a.search({ query: 'useeff' })), ['React hooks guide']);
  assert.deepEqual(titles(await a.search({ query: 'react hoo' })), ['React hooks guide']);
  assert.deepEqual(titles(await a.search({ query: 'rea hooks' })), [], 'a prefix in the middle does not match');
});

test('accent-insensitive, CJK bigrams, snippets with highlight ranges', async () => {
  const a = await seeded();
  const cafe = await a.search({ query: 'cafe' });
  assert.deepEqual(titles(cafe), ['Voyage à Paris']);
  const sn = cafe.results[0].snippets;
  assert.ok(sn.length >= 1);
  assert.ok(sn.some((s) => s.ranges.some(([x, y]) => /^caf[eé]/i.test(s.text.slice(x, y)))));
  const zh = await a.search({ query: '学习' });
  assert.deepEqual(titles(zh), ['机器学习笔记']);
  assert.ok(zh.results[0].titleRanges.length >= 1);
  assert.ok(zh.results[0].snippets.length >= 1);
});

test('filters: date range and an allowed-id list (folders)', async () => {
  const a = await seeded();
  assert.deepEqual(titles(await a.search({ query: 'hooks', from: 2500 })), ['React hooks guide']);
  assert.deepEqual(titles(await a.search({ query: 'hooks', to: 2500 })), []);
  assert.deepEqual(titles(await a.search({ query: 'hooks', ids: ['py0001'] })), []);
  assert.deepEqual(titles(await a.search({ query: 'hooks', ids: ['react1', 'py0001'] })), ['React hooks guide']);
  assert.deepEqual(titles(await a.search({ query: 'hooks', ids: [] })), [], 'an empty folder matches nothing');
});

test('re-saving a changed chat updates the index; the removed word is no longer found', async () => {
  const a = await seeded();
  await a.putChats([rec('py0001', 'Python sorting', [['user', 'sort a list of dicts by key'], ['assistant', 'Use operator.itemgetter instead.']], 4000)]);
  assert.deepEqual(titles(await a.search({ query: 'lambda' })), []);
  assert.deepEqual(titles(await a.search({ query: 'itemgetter' })), ['Python sorting']);
  assert.equal((await a.indexStats()).chats, 4, 'no duplicate entry');
});

test('deleting / clearing removes chats from the index', async () => {
  const a = await seeded();
  await a.deleteChats(['react1']);
  assert.deepEqual(titles(await a.search({ query: 'hooks' })), []);
  assert.equal((await a.indexStats()).chats, 3);
  const before = (await a.indexStats()).tokens;
  await a.clear();
  assert.deepEqual(await a.indexStats(), { chats: 0, tokens: 0, archived: 0 });
  assert.ok(before > 0);
});

test('rebuild: clear the index, then re-index from the archive in batches', async () => {
  const a = await seeded();
  await a.handle('indexClear');
  assert.equal((await a.indexStats()).chats, 0);
  assert.deepEqual(titles(await a.search({ query: 'hooks' })), []);
  const ids = (await a.list()).map((r) => r.id);
  assert.equal((await a.handle('indexBatch', { ids: ids.slice(0, 2) })).indexed, 2);
  assert.equal((await a.handle('indexBatch', { ids: ids.slice(2) })).indexed, 2);
  assert.deepEqual(titles(await a.search({ query: 'react hooks' })), ['React hooks guide']);
  assert.equal((await a.handle('indexBatch', { ids })).skipped, 4, 'idempotent');
});

test('putSeen merges a partial view into the stored chat and keeps the index right', async () => {
  const a = mk();
  await a.putChats([rec('long01', 'Long chat', [['user', 'q1 alpha'], ['assistant', 'a1'], ['user', 'q2'], ['assistant', 'a2']])]);
  await a.handle('putSeen', { records: [rec('long01', 'Long chat', [['user', 'q2'], ['assistant', 'a2'], ['user', 'q3 omega'], ['assistant', 'a3']])] });
  const [stored] = await a.getChats(['long01']);
  assert.deepEqual(stored.messages.map((m) => m.text), ['q1 alpha', 'a1', 'q2', 'a2', 'q3 omega', 'a3']);
  assert.deepEqual(titles(await a.search({ query: 'alpha' })), ['Long chat'], 'old text still indexed');
  assert.deepEqual(titles(await a.search({ query: 'omega' })), ['Long chat'], 'new text indexed');
});

test('a failing index never fails the save', async () => {
  const a = mk();
  a.index.indexChats = async () => { throw new Error('index exploded'); };
  const r = await a.putChats([rec('okok01', 'T', [['user', 'hello there']])]);
  assert.equal(r.saved, 1);
  assert.match(r.indexError, /index exploded/);
});

test('bad input: empty / junk queries and args never throw', async () => {
  const a = await seeded();
  for (const q of ['', 'a', '   ', '!!!', null, undefined, 12]) assert.deepEqual((await a.handle('search', { query: q })).results, []);
  assert.equal((await a.handle('search', null)).ok, true);
  assert.equal((await a.handle('search', { query: 'hooks', from: 'x', to: NaN, ids: 'nope', limit: -5 })).results.length, 1);
});

test('result caps: many matching chats are truncated, most recent kept', async () => {
  const a = mk();
  const many = Array.from({ length: SEARCH_LIMITS.candidates + 20 }, (_, i) => rec(`m${String(i).padStart(5, '0')}`, `Doc ${i}`, [['user', 'common keyword here']], 1000 + i));
  for (let i = 0; i < many.length; i += 100) await a.putChats(many.slice(i, i + 100));
  const r = await a.search({ query: 'keyword', limit: 100 });
  assert.equal(r.truncated, true);
  assert.equal(r.total, SEARCH_LIMITS.candidates + 20);
  assert.equal(r.results.length, 100);
});
