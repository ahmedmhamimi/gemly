import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeRecords } from '../../src/content/features/archive-search/merge-records.js';
import { buildSnippets, highlightRanges, scoreDocument } from '../../src/content/features/archive-search/snippets.js';
import { queryTokens } from '../../src/content/features/archive-search/tokenize.js';

const m = (role, text) => ({ role, text });
const rec = (msgs, extra = {}) => ({ id: 'c1', title: 'T', path: '/app/c1', capturedAt: 1, messages: msgs, ...extra });
const texts = (r) => r.messages.map((x) => x.text);
const U = (t) => m('user', t), A = (t) => m('assistant', t);

test('merge: a recent slice extends a stored chat (the chat continued)', () => {
  const stored = rec([U('q1'), A('a1'), U('q2'), A('a2')]);
  const slice = rec([U('q2'), A('a2'), U('q3'), A('a3')]);
  assert.deepEqual(texts(mergeRecords(stored, slice)), ['q1', 'a1', 'q2', 'a2', 'q3', 'a3']);
});

test('merge: a partial slice never DESTROYS stored history', () => {
  const stored = rec([U('q1'), A('a1'), U('q2'), A('a2'), U('q3'), A('a3')]);
  assert.deepEqual(texts(mergeRecords(stored, rec([U('q3'), A('a3')]))), ['q1', 'a1', 'q2', 'a2', 'q3', 'a3']);
  assert.deepEqual(texts(mergeRecords(stored, rec([A('a1'), U('q2'), A('a2')]))), texts(stored));
});

test('merge: the last overlapping reply may have changed (regenerated / was still streaming)', () => {
  const stored = rec([U('q1'), A('a1 partial')]);
  assert.deepEqual(texts(mergeRecords(stored, rec([U('q1'), A('a1 final answer')]))), ['q1', 'a1 final answer']);
  const long = rec([U('q0'), A('a0'), U('q1'), A('old')]);
  assert.deepEqual(texts(mergeRecords(long, rec([U('q1'), A('new')]))), ['q0', 'a0', 'q1', 'new']);
});

test('merge: a slice that reaches further back than what was stored', () => {
  const stored = rec([U('q2'), A('a2')]);
  assert.deepEqual(texts(mergeRecords(stored, rec([U('q1'), A('a1'), U('q2'), A('a2'), U('q3'), A('a3')]))), ['q1', 'a1', 'q2', 'a2', 'q3', 'a3']);
  assert.deepEqual(texts(mergeRecords(rec([U('q2'), A('a2'), U('q3'), A('a3')]), rec([U('q1'), A('a1'), U('q2'), A('a2')]))), ['q1', 'a1', 'q2', 'a2', 'q3', 'a3']);
});

test('merge: no overlap -> the longer side wins; title/path update; capturedAt is the newest', () => {
  const stored = rec([U('x'), A('y')], { capturedAt: 5, title: 'Old' });
  const other = rec([U('p'), A('q'), U('r')], { capturedAt: 2, title: 'New' });
  const r = mergeRecords(stored, other);
  assert.deepEqual(texts(r), ['p', 'q', 'r']);
  assert.equal(r.title, 'New');
  assert.equal(r.capturedAt, 5);
  assert.deepEqual(texts(mergeRecords(rec([U('x'), A('y'), U('z')]), rec([U('p')]))), ['x', 'y', 'z']);
});

test('merge: edge cases and purity', () => {
  const inc = rec([U('a')]);
  assert.equal(mergeRecords(null, inc), inc);
  assert.equal(mergeRecords(rec([]), inc), inc);
  const stored = rec([U('a'), A('b')]);
  const snapshot = JSON.stringify(stored);
  mergeRecords(stored, rec([U('a'), A('b'), U('c')]));
  assert.equal(JSON.stringify(stored), snapshot, 'inputs are not mutated');
  assert.deepEqual(texts(mergeRecords(rec([U('ok'), A('x'), U('ok'), A('y')]), rec([U('ok')]))), ['ok', 'x', 'ok', 'y'], 'a lone repeated message cannot truncate history');
});

test('highlightRanges: normalised matching, ranges in original text, prefix on the last token', () => {
  const text = 'Visit the Café on Monday; cafeteria too';
  const r = highlightRanges(text, queryTokens('cafe'));
  assert.deepEqual(r.map(([s, e]) => text.slice(s, e)), ['Café', 'cafeteria']);
  assert.deepEqual(highlightRanges(text, queryTokens('mon day')).map(([s, e]) => text.slice(s, e)), [], 'only the LAST token is a prefix');
  assert.deepEqual(highlightRanges(text, queryTokens('monday caf')).map(([s, e]) => text.slice(s, e)), ['Café', 'Monday', 'cafeteria']);
});

test('buildSnippets: window around the match, ranges relative, cut flags, whitespace normalised', () => {
  const filler = 'lorem ipsum dolor sit amet '.repeat(20);
  const text = `${filler}\nthe NEEDLE is here\n${filler}`;
  const [s] = buildSnippets(text, queryTokens('needle'), { radius: 30 });
  assert.equal(s.cutStart && s.cutEnd, true);
  assert.ok(!s.text.includes('\n'));
  assert.deepEqual(s.ranges.map(([a, b]) => s.text.slice(a, b)), ['NEEDLE']);
  assert.ok(s.text.length < 90);
  assert.deepEqual(buildSnippets('nothing relevant', queryTokens('zzz')), []);
  assert.deepEqual(buildSnippets('', queryTokens('x1')), []);
});

test('buildSnippets: best windows first by distinct-term coverage, at most `max`, CJK works', () => {
  const far = 'filler '.repeat(60);
  const text = `alpha ${far} beta ${far} alpha beta ${far}`;
  const out = buildSnippets(text, queryTokens('alpha beta'), { max: 1, radius: 20 });
  assert.equal(out.length, 1);
  assert.equal(out[0].ranges.length, 2, 'the window containing BOTH terms wins');
  const cjk = buildSnippets('我们正在学习机器学习的基础知识', queryTokens('机器学习'), { radius: 4 });
  assert.equal(cjk[0].ranges.length >= 1, true);
  assert.ok(cjk[0].text.includes('机器学习'));
});

test('scoreDocument: covering all terms beats repeating one; title weighs more than body', () => {
  const q = queryTokens('react hooks');
  const both = scoreDocument('x', ['react hooks guide'], q);
  const one = scoreDocument('x', ['react react react react react react'], q);
  assert.ok(both > one);
  assert.ok(scoreDocument('React hooks', ['nothing'], q) > scoreDocument('x', ['react hooks'], q));
  assert.equal(scoreDocument('x', ['y'], q), 0);
});

import { matchCounts } from '../../src/content/features/archive-search/snippets.js';

test('matchCounts: the ASCII pre-check never changes the result (no false negatives)', () => {
  const samples = ['Hello World', 'unrelated text here', 'Café au lait', 'mixed ASCII and 机器学习', 'UPPER hooks', 'react-hooks_v2', ''];
  for (const q of ['hello', 'hoo', 'cafe', '学习', 'react', 'zzz', 'v2']) {
    const qt = queryTokens(q);
    for (const text of samples) {
      const fast = matchCounts(text, qt);
      // Reference: bypass the pre-check by prepending a non-ASCII char that tokenizes to nothing.
      const slow = matchCounts(`\u00b7${text}`, qt);
      assert.deepEqual(fast, slow, `${JSON.stringify(q)} on ${JSON.stringify(text)}`);
    }
  }
});
