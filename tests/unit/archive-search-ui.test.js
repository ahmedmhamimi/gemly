import test from 'node:test';
import assert from 'node:assert/strict';
import { dayEnd, dayStart, splitByRanges } from '../../src/content/features/archive-search/render.js';
import { ArchiveClient } from '../../src/content/core/archive-client.js';
import { Archive, MemoryBackend } from '../../src/background/archive.js';
import { makeRecord } from '../../src/content/features/export/serialize/record.js';

test('splitByRanges: alternating segments, no empty pieces, ignores malformed ranges', () => {
  assert.deepEqual(splitByRanges('hello big world', [[6, 9]]), [{ text: 'hello ', hit: false }, { text: 'big', hit: true }, { text: ' world', hit: false }]);
  assert.deepEqual(splitByRanges('abc', [[0, 3]]), [{ text: 'abc', hit: true }]);
  assert.deepEqual(splitByRanges('abc', []), [{ text: 'abc', hit: false }]);
  assert.deepEqual(splitByRanges('abc', [[2, 9], [1, 1], [-1, 2]]), [{ text: 'abc', hit: false }], 'out-of-bounds / empty / negative ignored');
  assert.deepEqual(splitByRanges('ab cd', [[0, 2], [1, 4]]).map((s) => s.text).join(''), 'ab cd', 'overlap is skipped, text never lost');
  assert.deepEqual(splitByRanges('', [[0, 1]]), []);
});

test('dayStart / dayEnd: local day bounds, null for empty or invalid', () => {
  const s = dayStart('2026-03-05'), e = dayEnd('2026-03-05');
  assert.equal(new Date(s).getHours() + new Date(s).getMinutes(), 0);
  assert.equal(new Date(e).getHours(), 23);
  assert.ok(e - s > 86_000_000 && e - s < 86_500_000 + 3_600_000);
  for (const bad of ['', null, undefined, '2026-3-5', 'tomorrow', '2026-03-05T10:00']) assert.equal(dayStart(bad), null);
  assert.equal(dayEnd(''), null);
});

test('client search / putSeen / index ops talk to the real archive over a fake runtime', async () => {
  const archive = new Archive(new MemoryBackend());
  globalThis.chrome = { runtime: { sendMessage: async (m) => archive.handle(m.op, m.args) } };
  const rec = (msgs) => makeRecord({ id: 'chat01', title: 'Planning', path: '/app/chat01', capturedAt: 7, conversation: { messages: msgs.map(([role, content]) => ({ role, content, isHTML: false })) } });
  await ArchiveClient.putChats([rec([['user', 'budget alpha'], ['assistant', 'ok'], ['user', 'next'], ['assistant', 'sure']])]);
  await ArchiveClient.putSeen([rec([['user', 'next'], ['assistant', 'sure'], ['user', 'budget omega'], ['assistant', 'done']])]);

  const hit = await ArchiveClient.search({ query: 'alpha' });
  assert.equal(hit.results.length, 1, 'the part only the first save had is still searchable after a partial putSeen');
  assert.equal((await ArchiveClient.search({ query: 'omega' })).results.length, 1);
  assert.deepEqual(Object.keys(hit).sort(), ['results', 'tokens', 'total', 'truncated']);

  assert.deepEqual(await ArchiveClient.indexStats(), { chats: 1, tokens: (await ArchiveClient.indexStats()).tokens, archived: 1 });
  await ArchiveClient.indexClear();
  assert.equal((await ArchiveClient.search({ query: 'alpha' })).results.length, 0);
  assert.equal(await ArchiveClient.indexBatch(['chat01']), 1);
  assert.equal((await ArchiveClient.search({ query: 'alpha' })).results.length, 1);
});
