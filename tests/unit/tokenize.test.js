import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWord, queryTokens, tokenize, tokenizeWithPositions } from '../../src/content/features/archive-search/tokenize.js';

const toks = (s) => tokenizeWithPositions(s).map((x) => x.t);

test('words, case folding, punctuation and short tokens', () => {
  assert.deepEqual(toks('Hello, World! a x1 snake_case 42 7'), ['hello', 'world', 'x1', 'snake', 'case', '42']);
});

test('accents and diacritics are dropped on both sides', () => {
  assert.deepEqual(toks('Café résumé Ёлка'), ['cafe', 'resume', 'елка']);
  assert.equal(normalizeWord('الإسلام'), normalizeWord('الاسلام'));
  assert.equal(normalizeWord('مُحَمَّد'), 'محمد');
  assert.equal(normalizeWord('على'), normalizeWord('علي'), 'alef maqsura == yeh');
});

test('Devanagari vowel signs are NOT destroyed by diacritic stripping', () => {
  assert.equal(normalizeWord('हिन्दी'), 'हिन्दी');
});

test('CJK / Thai produce bigrams (single char for a lone one)', () => {
  assert.deepEqual(toks('机器学习'), ['机器', '器学', '学习']);
  assert.deepEqual(toks('我'), ['我']);
  assert.deepEqual(toks('これは'), ['これ', 'れは']);
  assert.deepEqual(toks('Python机器学习2'), ['python', '机器', '器学', '学习'], 'mixed script splits at the boundary; a lone digit is dropped');
  assert.ok(toks('สวัสดีครับ').length > 3);
});

test('offsets point into the ORIGINAL text, even where normalisation changes the word', () => {
  const text = 'Un café noir, 机器学习!';
  for (const { t, s, e } of tokenizeWithPositions(text)) {
    const piece = text.slice(s, e);
    assert.ok(piece.length > 0, t);
    assert.equal(normalizeWord(piece) === t || /^[\p{Script=Han}]+$/u.test(piece), true, `${t} <- "${piece}"`);
  }
  const cafe = tokenizeWithPositions(text).find((x) => x.t === 'cafe');
  assert.equal(text.slice(cafe.s, cafe.e), 'café');
});

test('astral characters keep correct offsets', () => {
  const text = '😀 hello 𠀀𠀁𠀂';
  const t = tokenizeWithPositions(text);
  assert.equal(text.slice(t[0].s, t[0].e), 'hello');
  assert.equal(text.slice(t[1].s, t[1].e), '𠀀𠀁');
});

test('tokenize: unique, capped; queryTokens: unique, ordered, capped, nothing for a lone letter', () => {
  assert.deepEqual(tokenize('b a1 b a1 cc'), ['a1', 'cc'], 'unique, one-letter words dropped');
  assert.equal(tokenize('word '.repeat(10) + Array.from({ length: 8000 }, (_, i) => `w${i}x`).join(' ')).length, 6000);
  assert.deepEqual(queryTokens('React hooks react'), ['react', 'hooks']);
  assert.deepEqual(queryTokens('a'), []);
  assert.equal(queryTokens('one two three four five six seven eight nine ten').length, 8);
});

test('a very long word is ignored, huge input stays fast', () => {
  assert.deepEqual(toks('x'.repeat(41) + ' ok'), ['ok']);
  const t0 = Date.now();
  tokenize('lorem ipsum dolor '.repeat(100000));
  assert.ok(Date.now() - t0 < 2000);
});
