import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeHandoff, sanitizeSummary } from '../../src/content/core/schema.js';
import { SummaryError, buildHandoff, contextPercent, continueInNewChat, freshHandoff, resolveText, shouldSuggest, summarizeChat } from '../../src/content/features/summarize/logic.js';

test('sanitizeSummary: defaults, clamped threshold, strings capped, junk tolerated', () => {
  assert.deepEqual(sanitizeSummary(null), { prompt: '', intro: '', hintAt: 70 });
  assert.equal(sanitizeSummary({ hintAt: 5 }).hintAt, 30);
  assert.equal(sanitizeSummary({ hintAt: 500 }).hintAt, 95);
  assert.equal(sanitizeSummary({ hintAt: 62.6 }).hintAt, 63);
  assert.equal(sanitizeSummary({ hintAt: 'x' }).hintAt, 70);
  assert.equal(sanitizeSummary({ prompt: 'p'.repeat(9000) }).prompt.length, 4000);
  assert.equal(sanitizeSummary({ prompt: 5, intro: {} }).prompt, '');
});

test('sanitizeHandoff: needs text and a timestamp; freshHandoff expires it', () => {
  assert.equal(sanitizeHandoff({ text: '  ', at: 1 }), null);
  assert.equal(sanitizeHandoff({ text: 'x' }), null);
  assert.equal(sanitizeHandoff('x'), null);
  const h = sanitizeHandoff({ text: 'hello', at: 1000 });
  assert.deepEqual(h, { text: 'hello', at: 1000 });
  assert.equal(freshHandoff(h, 1000 + 60_000), h);
  assert.equal(freshHandoff(h, 1000 + 121_000), null, 'older than 2 minutes');
  assert.equal(freshHandoff(h, 500), null, 'a timestamp in the future is not trusted');
  assert.equal(freshHandoff(null), null);
});

test('contextPercent / shouldSuggest: clamped, threshold respected and itself clamped', () => {
  assert.equal(contextPercent(524288, 1048576), 50);
  assert.equal(contextPercent(5e9, 1048576), 100);
  assert.equal(contextPercent(10, 0), 0);
  assert.equal(shouldSuggest(69.9), false);
  assert.equal(shouldSuggest(70), true);
  assert.equal(shouldSuggest(50, 50), true);
  assert.equal(shouldSuggest(20, 5), false, 'a threshold below the minimum is raised to 30');
  assert.equal(shouldSuggest(97, 500), true, 'above the maximum is lowered to 95');
  assert.equal(shouldSuggest(80, NaN), true);
});

test('resolveText / buildHandoff', () => {
  assert.equal(resolveText('  mine ', 'default'), 'mine');
  assert.equal(resolveText('   ', 'default'), 'default');
  assert.equal(resolveText(undefined, 'default'), 'default');
  assert.equal(buildHandoff('Context:', '  the summary \n'), 'Context:\n\nthe summary');
  assert.equal(buildHandoff('  ', 'the summary'), 'the summary');
});

const LONG = 'A proper summary of the conversation with goals and decisions.';

test('summarizeChat: sends the prompt once, then reads and returns the summary', async () => {
  const sent = [];
  const s = await summarizeChat({ prompt: 'summarize', send: async (t) => void sent.push(t), getChatId: () => 'c1', readSummary: () => ` ${LONG} ` });
  assert.deepEqual(sent, ['summarize']);
  assert.equal(s, LONG);
});

test('summarizeChat errors: no chat (nothing is sent), left the chat, empty answer, send failure passes through', async () => {
  const code = async (o) => { try { await summarizeChat({ prompt: 'p', send: async () => {}, getChatId: () => 'c1', readSummary: () => LONG, ...o }); } catch (e) { return e.code; } return 'ok'; };
  let sent = 0;
  assert.equal(await code({ getChatId: () => null, send: async () => void sent++ }), 'no-chat');
  assert.equal(sent, 0);
  let id = 'c1';
  assert.equal(await code({ getChatId: () => id, send: async () => { id = 'other'; } }), 'navigated');
  assert.equal(await code({ readSummary: () => 'short' }), 'empty-summary');
  assert.equal(await code({ readSummary: () => '' }), 'empty-summary');
  assert.equal(await code({ send: async () => { throw Object.assign(new Error('x'), { code: 'timeout' }); } }), 'timeout');
  assert.ok(new SummaryError('no-chat') instanceof Error);
});

test('continueInNewChat: pre-fills when a fresh chat opens; falls back to a stored handoff + reload; never loses the text', async () => {
  const log = [];
  const base = { text: 'T', persistHandoff: (t) => log.push(`persist:${t}`), reload: () => log.push('reload'), insert: (t) => (log.push(`insert:${t}`), true), openFresh: async () => true };
  assert.equal(await continueInNewChat(base), 'inserted');
  assert.deepEqual(log.splice(0), ['insert:T']);
  assert.equal(await continueInNewChat({ ...base, openFresh: async () => false }), 'reloading');
  assert.deepEqual(log.splice(0), ['persist:T', 'reload']);
  assert.equal(await continueInNewChat({ ...base, insert: () => false }), 'failed');
  assert.deepEqual(log.splice(0), ['persist:T'], 'a failed insert keeps the text for a retry');
});
