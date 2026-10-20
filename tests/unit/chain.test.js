import test from 'node:test';
import assert from 'node:assert/strict';
import { ChainError, runChain, sendAndWait } from '../../src/content/features/prompts/chain.js';

const FAST = { busyMs: 80, canSendMs: 80, startMs: 80, doneMs: 400, intervalMs: 2, settleMs: 1, betweenMs: 1 };

test('runChain: runs steps in order, reports progress, stops nothing when all succeed', async () => {
  const sent = [], ev = [];
  const r = await runChain({ steps: ['a', 'b', 'c'], pauseMs: 1, send: async (t) => void sent.push(t), onStep: (p) => ev.push(`${p.state}${p.index}`) });
  assert.deepEqual(sent, ['a', 'b', 'c']);
  assert.deepEqual(r, { completed: 3, total: 3, cancelled: false, error: null });
  assert.deepEqual(ev, ['start0', 'done0', 'start1', 'done1', 'start2', 'done2']);
});

test('runChain: a failing step ends the chain with its code; later steps are never sent', async () => {
  const sent = [];
  const r = await runChain({ steps: ['a', 'b', 'c'], pauseMs: 1, send: async (t) => { sent.push(t); if (t === 'b') throw new ChainError('send-failed'); } });
  assert.deepEqual(sent, ['a', 'b']);
  assert.deepEqual([r.completed, r.error, r.cancelled], [1, 'send-failed', false]);
});

test('runChain: Stop cancels before the next step', async () => {
  const ac = new AbortController();
  const sent = [];
  const r = await runChain({ steps: ['a', 'b', 'c'], pauseMs: 1, signal: ac.signal, send: async (t) => { sent.push(t); if (t === 'a') ac.abort(); } });
  assert.equal(r.cancelled, true);
  assert.deepEqual(sent, ['a']);
});

test('runChain: Stop during a long wait aborts it promptly', async () => {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 20);
  const t0 = Date.now();
  const r = await runChain({ steps: ['a', 'b'], pauseMs: 1, signal: ac.signal, send: (t, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new (class extends Error { constructor() { super('cancelled'); this.name = 'JobCancelled'; } })()))) });
  assert.ok(Date.now() - t0 < 500);
  assert.equal(r.completed, 0);
});

/** A scriptable fake page: typing fills the box, Send clears it, a reply "generates" for `replyMs`. */
function fakePage({ replyMs = 15, canSendNever = false, neverStarts = false, stuckBox = false, neverEnds = false } = {}) {
  const st = { text: stuckBox ? 'old draft' : '', generating: false, turns: 0, log: [] };
  const editor = {};
  const btn = { click() {
    st.log.push(`send:${st.text}`);
    st.text = '';
    if (neverStarts) return;
    st.generating = true; st.turns += 2;
    if (!neverEnds) setTimeout(() => { st.generating = false; }, replyMs);
  } };
  return { st, host: {
    editor: () => editor, editorText: () => st.text, isGenerating: () => st.generating, turns: () => ({ length: st.turns }),
    sendButton: () => btn, canSend: () => !canSendNever && st.text.trim().length > 0,
  }, insert: (_, text) => { st.text += text; return true; } };
}

test('sendAndWait: inserts, sends, and resolves only after the reply has finished', async () => {
  const { st, host, insert } = fakePage({ replyMs: 30 });
  await sendAndWait('hello', { index: 0, host, insert, timing: FAST });
  assert.deepEqual(st.log, ['send:hello']);
  assert.equal(st.generating, false, 'resolved after generation ended');
});

test('sendAndWait: errors are precise (no editor, draft in the box, cannot send, never starts, never ends)', async () => {
  const code = async (page, h = page.host) => { try { await sendAndWait('x', { index: 0, host: h, insert: page.insert, timing: FAST }); } catch (e) { return e.code; } return 'ok'; };
  const noEditor = fakePage(); noEditor.host.editor = () => null;
  assert.equal(await code(noEditor), 'no-editor');
  assert.equal(await code(fakePage({ stuckBox: true })), 'composer-busy');
  assert.equal(await code(fakePage({ canSendNever: true })), 'send-failed');
  assert.equal(await code(fakePage({ neverStarts: true })), 'send-failed');
  assert.equal(await code(fakePage({ neverEnds: true })), 'timeout');
  const noInsert = fakePage(); noInsert.insert = () => false;
  assert.equal(await code(noInsert), 'no-editor');
});

test('a two-step chain through the fake page sends both texts in order, one reply apart', async () => {
  const page = fakePage({ replyMs: 20 });
  const r = await runChain({ steps: ['first', 'second'], pauseMs: 1, send: (t, c) => sendAndWait(t, { ...c, host: page.host, insert: page.insert, timing: FAST }) });
  assert.deepEqual(page.st.log, ['send:first', 'send:second']);
  assert.equal(r.completed, 2);
});

import { makeChainSender } from '../../src/content/features/prompts/chain.js';

test('navigation guard: the next step is NOT sent into a different chat; a new chat getting its id after step 1 is fine', async () => {
  const page = fakePage({ replyMs: 10 });
  let convId = null; // starts on the empty "new chat" page
  page.host.currentConversationId = () => convId;
  const send = makeChainSender({ host: page.host, insert: page.insert, timing: FAST });
  await send('one', { signal: undefined });
  convId = 'abc123'; // Gemini assigned an id after the first reply: expected
  await send('two', { signal: undefined });
  convId = 'someOtherChat'; // the person opened another chat
  await assert.rejects(send('three', { signal: undefined }), (e) => e instanceof ChainError && e.code === 'navigated');
  assert.deepEqual(page.st.log, ['send:one', 'send:two'], 'step 3 never reached the page');
});
