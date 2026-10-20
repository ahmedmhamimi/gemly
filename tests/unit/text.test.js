import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanLabel, debounce, escapeHtml, foldCase, hashText, sanitizeFilename, truncate, uid } from '../../src/content/util/text.js';

test('escapeHtml escapes quotes so attribute values cannot break out', () => {
  assert.equal(escapeHtml(`a"b'c<d>&`), 'a&quot;b&#39;c&lt;d&gt;&amp;');
  assert.equal(escapeHtml(null), '');
  const attr = `placeholder="${escapeHtml('Title (e.g. "Explain simply")')}"`;
  assert.equal((attr.match(/"/g) || []).length, 2); // only the two delimiters
});

test('sanitizeFilename handles hostile and edge-case names', () => {
  assert.equal(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j'), 'a-b-c-d-e-f-g-h-i-j');
  assert.equal(sanitizeFilename('CON'), 'Gemini-Conversation');
  assert.equal(sanitizeFilename('nul.txt'), 'Gemini-Conversation');
  assert.equal(sanitizeFilename('   '), 'Gemini-Conversation');
  assert.equal(sanitizeFilename('...hidden...'), 'hidden');
  assert.equal(sanitizeFilename('name.\u202e\u200bgpj'), 'name.gpj'); // bidi/zero-width stripped
  assert.equal(sanitizeFilename('trailing dot.'), 'trailing-dot');
  assert.equal(sanitizeFilename('x'.repeat(500)).length, 80);
  const emoji = sanitizeFilename('😀'.repeat(100));
  assert.equal(Array.from(emoji).length, 80); // never splits a surrogate pair
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(emoji));
  assert.equal(sanitizeFilename('', 'fallback'), 'fallback');
  assert.equal(sanitizeFilename(undefined), 'Gemini-Conversation');
});

test('foldCase never changes string length (match offsets stay valid)', () => {
  for (const s of ['İstanbul', 'STRASSE ẞ', 'ǅ', 'Ω ΑΣ', 'ﬃ']) assert.equal(foldCase(s).length, s.length, s);
  assert.equal(foldCase('HeLLo'), 'hello');
});

test('truncate is code-point safe', () => {
  assert.equal(truncate('😀😀😀😀', 2), '😀😀\u2026');
  assert.equal(truncate('short', 10), 'short');
});

test('cleanLabel strips control/bidi chars and clamps', () => {
  assert.equal(cleanLabel('  a\u0000b\u202e  c  ', 10), 'a b c');
  assert.equal(cleanLabel('x'.repeat(100), 5), 'xxxxx');
  assert.equal(cleanLabel(undefined, 5), '');
});

test('hashText is stable and discriminating; uid is unique', () => {
  assert.equal(hashText('abc'), hashText('abc'));
  assert.notEqual(hashText('abc'), hashText('abd'));
  assert.equal(new Set(Array.from({ length: 5000 }, () => uid())).size, 5000);
});

test('debounce coalesces and can be cancelled', async () => {
  let n = 0;
  const d = debounce(() => n++, 15);
  d(); d(); d();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(n, 1);
  d(); d.cancel();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(n, 1);
});
