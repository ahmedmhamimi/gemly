import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, setupChrome } from './env.js';

setupDom();
setupChrome();
const { Emitter } = await import('../../src/content/core/events.js');
const { Scheduler } = await import('../../src/content/core/scheduler.js');
const { GeminiHost } = await import('../../src/content/host/gemini.js');
const { htmlNodeToPlainText } = await import('../../src/content/util/plaintext.js');
const { MessageIndex } = await import('../../src/content/core/message-index.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('Emitter: unsubscribe, handler errors isolated, self-unsubscribe during emit', () => {
  const e = new Emitter();
  const seen = [];
  const origError = console.error;
  console.error = () => {};
  e.on('x', () => { throw new Error('boom'); });
  const off = e.on('x', () => seen.push('a'));
  e.on('x', function once() { seen.push('b'); });
  e.emit('x');
  e.emit('x', 1);
  off();
  e.emit('x');
  console.error = origError;
  assert.deepEqual(seen, ['a', 'b', 'a', 'b', 'b']);
});

test('Scheduler: leading edge, rate-limited, never starves under a constant stream', async () => {
  let runs = 0;
  const s = new Scheduler({ run: () => runs++, intervalMs: () => 100 });
  const t0 = performance.now();
  s.request();
  await sleep(20);
  assert.equal(runs, 1, 'first request runs almost immediately');
  while (performance.now() - t0 < 520) { s.markAll(); s.request(); await sleep(5); }
  s.dispose();
  assert.ok(runs >= 4 && runs <= 7, `runs=${runs} (a trailing debounce would be 1)`);
});

test('Scheduler: batches carry dirty zones and reset after each run', async () => {
  const batches = [];
  const s = new Scheduler({ run: (b) => batches.push([...b.zones].sort().join('+') + (b.all ? '!' : '')), intervalMs: () => 10 });
  s.mark('chat'); s.mark('sidebar'); s.request();
  await sleep(40);
  s.markAll(); s.request();
  await sleep(40);
  s.mark('composer'); s.request();
  await sleep(40);
  s.dispose();
  assert.deepEqual(batches, ['chat+sidebar', '!', 'composer']);
});

test('Scheduler: dispose cancels pending work', async () => {
  let runs = 0;
  const s = new Scheduler({ run: () => runs++, intervalMs: () => 30 });
  s.request({ immediate: false });
  s.dispose();
  await sleep(80);
  assert.equal(runs, 0);
});

test('host.conversationId parses real Gemini URL shapes and rejects non-chat routes', () => {
  const id = (u) => GeminiHost.conversationId(u);
  assert.equal(id('/app/abc123def456'), 'abc123def456');
  assert.equal(id('https://gemini.google.com/u/1/app/abc123def456?hl=ar'), 'abc123def456');
  assert.equal(id('/gem/gem1/ggg111hhh222'), 'ggg111hhh222');
  assert.equal(id('/u/2/gem/gemX/ggg111hhh222/'), 'ggg111hhh222');
  assert.equal(id('/app'), null);
  assert.equal(id('/app/'), null);
  assert.equal(id('/app/short'), null);
  assert.equal(id('/app/download'), null);
  assert.equal(id('/gems/view'), null);
  assert.equal(id(''), null);
  assert.equal(id(null), null);
});

test('plain text: nested lists on their own lines, code header skipped, math kept, links annotated', () => {
  const d = document.createElement('div');
  d.innerHTML = `<p>Hi <a href="https://x.dev">site</a> <a href="#frag">frag</a> <a href="javascript:alert(1)">bad</a></p>
    <ul><li>One<ul><li>Nested</li></ul></li><li>Two</li></ul><ol><li>A</li><li>B</li></ol>
    <div class="code-block"><div class="code-header">python</div><pre><code>print(1)\n</code></pre></div>
    <span class="math-inline" data-math="x^2">garbage glyphs</span><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
    <button>Copy</button><source-footnote>9</source-footnote>`;
  const t = htmlNodeToPlainText(d);
  assert.match(t, /Hi site \(https:\/\/x\.dev\) frag bad/);
  assert.match(t, /- One\n- Nested\n- Two/);
  assert.match(t, /1\. A\n2\. B/);
  assert.ok(!t.includes('python'), 'code header text excluded');
  assert.match(t, /print\(1\)/);
  assert.match(t, /x\^2/);
  assert.ok(!t.includes('garbage'));
  assert.match(t, /\nA \| B\n1 \| 2/);
  assert.ok(!t.includes('Copy') && !t.includes('9'));
});

test('MessageIndex: cached until invalidated; epoch invalidates all; code re-priced', () => {
  document.body.innerHTML = '<user-query><div class="query-text">hello there</div></user-query><model-response><message-content><div class="markdown"><p>prose</p><pre>' + 'x'.repeat(300) + '</pre></div></message-content></model-response>';
  const [u, m] = GeminiHost.turns();
  const idx = new MessageIndex();
  const e1 = idx.entry(u);
  assert.equal(idx.entry(u), e1, 'cached object identity');
  u.querySelector('.query-text').textContent = 'hello there, friend, how are you today';
  assert.equal(idx.entry(u), e1, 'stale until invalidated (by design: app invalidates from mutations)');
  idx.invalidate(u);
  const e2 = idx.entry(u);
  assert.notEqual(e2, e1);
  assert.ok(e2.tokens > e1.tokens);
  idx.invalidateAll();
  assert.notEqual(idx.entry(u), e2);
  assert.equal(idx.entry(m).role, 'assistant');
  assert.ok(idx.entry(m).tokens >= 100, 'pre re-priced at the code ratio (300/3)');
  assert.equal(idx.totalTokens([u, m]), idx.entry(u).tokens + idx.entry(m).tokens);
});
