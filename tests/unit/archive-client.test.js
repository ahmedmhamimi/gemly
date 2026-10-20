import test from 'node:test';
import assert from 'node:assert/strict';
import { ArchiveClient, ArchiveError, batchRecords } from '../../src/content/core/archive-client.js';
import { Archive, MemoryBackend } from '../../src/background/archive.js';

const rec = (i, len = 10) => ({ id: `id${String(i).padStart(5, '0')}`, title: 't', messages: [{ role: 'user', text: 'x'.repeat(len) }, { role: 'assistant', text: 'y', html: `<p>${'z'.repeat(len)}</p>` }] });

test('batchRecords: bounded by count and by size, order preserved, nothing lost', () => {
  const recs = Array.from({ length: 100 }, (_, i) => rec(i));
  const byCount = batchRecords(recs, { maxRecords: 40, maxChars: 1e9 });
  assert.deepEqual(byCount.map((b) => b.length), [40, 40, 20]);
  const big = [rec(1, 1000), rec(2, 1000), rec(3, 1000)];
  assert.deepEqual(batchRecords(big, { maxRecords: 40, maxChars: 2500 }).map((b) => b.length), [1, 1, 1]);
  assert.equal(batchRecords([rec(1, 10_000_000)], { maxChars: 100 }).length, 1, 'one oversized record still goes alone');
  assert.deepEqual(batchRecords([]), []);
  assert.deepEqual(batchRecords(recs).flat().map((r) => r.id), recs.map((r) => r.id));
});

test('client <-> worker over a fake runtime: batching, totals, errors', async () => {
  const archive = new Archive(new MemoryBackend());
  let messages = 0;
  globalThis.chrome = { runtime: { sendMessage: async (m) => (messages++, archive.handle(m.op, m.args)) } };
  const recs = Array.from({ length: 90 }, (_, i) => rec(i));
  const r = await ArchiveClient.putChats(recs);
  assert.deepEqual(r, { saved: 90, unchanged: 0, rejected: 0 });
  assert.ok(messages >= 3, 'sent in several messages');
  assert.equal((await ArchiveClient.stats()).count, 90);
  assert.equal((await ArchiveClient.getChats(recs.slice(0, 5).map((x) => x.id))).length, 5);
  assert.equal((await ArchiveClient.putChats(recs)).unchanged, 90);
  assert.equal(await ArchiveClient.deleteChats([recs[0].id]), 1);
  await ArchiveClient.clear();
  assert.equal((await ArchiveClient.list()).length, 0);
});

test('a missing worker or a failure surfaces as ArchiveError', async () => {
  globalThis.chrome = { runtime: { sendMessage: async () => undefined } };
  await assert.rejects(ArchiveClient.stats(), (e) => e instanceof ArchiveError && e.message === 'no-response');
  globalThis.chrome = { runtime: { sendMessage: async () => { throw new Error('Extension context invalidated.'); } } };
  await assert.rejects(ArchiveClient.list(), /context invalidated/);
});
