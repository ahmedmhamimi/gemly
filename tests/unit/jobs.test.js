import test from 'node:test';
import assert from 'node:assert/strict';
import { FatalJobError, JobCancelled, chunk, runJob, sleep } from '../../src/content/core/jobs.js';

const noYield = () => Promise.resolve();
const run = (o) => runJob({ yieldFn: noYield, retryDelayMs: 1, ...o });

test('runs items in order, reports progress, returns every result', async () => {
  const order = [];
  const events = [];
  const r = await run({ items: [1, 2, 3], worker: async (n) => (order.push(n), n * 2), onProgress: (p) => events.push(`${p.state}${p.item}`) });
  assert.deepEqual(order, [1, 2, 3]);
  assert.deepEqual(r.results.map((x) => x.value), [2, 4, 6]);
  assert.deepEqual(events, ['start1', 'ok1', 'start2', 'ok2', 'start3', 'ok3']);
  assert.deepEqual([r.done, r.failed, r.cancelled, r.fatal], [3, 0, false, null]);
});

test('a failing item is recorded and the batch continues', async () => {
  const r = await run({ items: ['a', 'bad', 'c'], worker: async (x) => { if (x === 'bad') throw new Error('nope'); return x; } });
  assert.deepEqual(r.results.map((x) => x.ok), [true, false, true]);
  assert.equal(r.failed, 1);
  assert.match(r.results[1].error.message, /nope/);
});

test('retries: succeeds on a later attempt; gives up after the limit', async () => {
  let calls = 0;
  const ok = await run({ items: [1], retries: 2, worker: async (_, { attempt }) => { calls++; if (attempt < 2) throw new Error('flaky'); return 'fine'; } });
  assert.equal(ok.results[0].value, 'fine');
  assert.equal(calls, 3);
  const bad = await run({ items: [1], retries: 1, worker: async () => { throw new Error('always'); } });
  assert.equal(bad.failed, 1);
});

test('FatalJobError stops the batch immediately and is reported', async () => {
  const seen = [];
  const r = await run({ items: [1, 2, 3], worker: async (n) => { seen.push(n); if (n === 2) throw new FatalJobError('unknown dialog'); } });
  assert.deepEqual(seen, [1, 2]);
  assert.equal(r.fatal.message, 'unknown dialog');
  assert.equal(r.done, 2);
  assert.equal(r.failed, 1);
});

test('cancel between items and mid-item; the cancelled item is not counted', async () => {
  const ac = new AbortController();
  const r = await run({ items: [1, 2, 3, 4], signal: ac.signal, worker: async (n, { signal }) => {
    if (n === 2) { ac.abort(); await sleep(50, signal); }
    return n;
  } });
  assert.equal(r.cancelled, true);
  assert.deepEqual(r.results.map((x) => x.item), [1]);

  const pre = new AbortController();
  pre.abort();
  const r2 = await run({ items: [1], signal: pre.signal, worker: async () => assert.fail('must not start') });
  assert.equal(r2.cancelled, true);
});

test('cancelling during the retry back-off stops cleanly', async () => {
  const ac = new AbortController();
  const p = runJob({ items: [1], signal: ac.signal, retries: 3, retryDelayMs: 500, yieldFn: noYield, worker: async () => { throw new Error('x'); } });
  setTimeout(() => ac.abort(), 20);
  const r = await p;
  assert.equal(r.cancelled, true);
});

test('a worker that throws JobCancelled counts as cancel, an empty list is fine', async () => {
  const r = await run({ items: [1, 2], worker: async () => { throw new JobCancelled(); } });
  assert.equal(r.cancelled, true);
  assert.deepEqual((await run({ items: [], worker: async () => {} })).results, []);
});

test('yields between items (page stays responsive)', async () => {
  let yields = 0;
  await runJob({ items: [1, 2, 3], worker: async () => {}, yieldFn: async () => { yields++; } });
  assert.equal(yields, 3);
});

test('chunk', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
});

import { createStabilityTracker, waitUntil } from '../../src/content/core/jobs.js';

test('waitUntil: true when satisfied, false on timeout, cancellable', async () => {
  let n = 0;
  assert.equal(await waitUntil(() => ++n >= 3, { intervalMs: 1, timeoutMs: 500 }), true);
  assert.equal(await waitUntil(() => false, { intervalMs: 1, timeoutMs: 20 }), false);
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 10);
  await assert.rejects(waitUntil(() => false, { intervalMs: 5, timeoutMs: 5000, signal: ac.signal }), JobCancelled);
});

test('stability tracker: needs N identical observations in a row', () => {
  const t = createStabilityTracker(3);
  assert.deepEqual(['a', 'a', 'b', 'b', 'b', 'b'].map((s) => t.observe(s)), [false, false, false, false, true, true]);
  t.reset();
  assert.equal(t.observe('b'), false);
});
