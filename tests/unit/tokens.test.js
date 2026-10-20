import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateCodeTokens, estimateTokens } from '../../src/content/util/tokens.js';

test('empty / whitespace-only text is zero tokens', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('   \n\t '), 0);
  assert.equal(estimateTokens(null), 0);
});

test('English ~4 chars/token, never below 1 for real text', () => {
  assert.equal(estimateTokens('hi'), 1);
  const t = estimateTokens('The quick brown fox jumps over the lazy dog'); // 35 non-space chars
  assert.ok(t >= 7 && t <= 12, String(t));
});

test('non-Latin scripts cost more tokens per character than Latin', () => {
  const n = 40;
  const latin = estimateTokens('a'.repeat(n));
  assert.ok(estimateTokens('م'.repeat(n)) > latin, 'arabic');
  assert.ok(estimateTokens('я'.repeat(n)) > latin, 'cyrillic');
  assert.ok(estimateTokens('你'.repeat(n)) > estimateTokens('م'.repeat(n)), 'cjk > arabic');
  assert.ok(estimateTokens('😀'.repeat(n)) > latin, 'emoji');
  assert.ok(estimateTokens('क'.repeat(n)) > latin, 'devanagari');
});

test('code is priced at the code ratio', () => {
  assert.equal(estimateCodeTokens(0), 0);
  assert.equal(estimateCodeTokens(300), 100);
  assert.equal(estimateCodeTokens(1), 1);
});

test('huge input stays fast', () => {
  const t0 = performance.now();
  estimateTokens('lorem ipsum dolor '.repeat(100000));
  assert.ok(performance.now() - t0 < 1500);
});
