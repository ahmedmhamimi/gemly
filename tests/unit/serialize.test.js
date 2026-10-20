import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRecord, recordSignature, sanitizeRecord, sanitizeSaved } from '../../src/content/features/export/serialize/record.js';
import { recordToMarkdown, recordsToHtml, savedMarkdown } from '../../src/content/features/export/serialize/documents.js';

const labels = { user: 'You', assistant: 'Gemini' };
const conv = {
  title: 'Sorting <b>',
  messages: [
    { role: 'user', content: 'sort a list\n# not a heading', isHTML: false },
    { role: 'assistant', content: '<p>Use <code class="inline-code">sorted()</code></p><div class="code-block"><div class="code-header">Python</div><pre><code>sorted(x)</code></pre></div>', isHTML: true },
  ],
};
const rec = () => makeRecord({ id: 'abc123def456', path: '/app/abc123def456', conversation: conv, capturedAt: 5 });

test('makeRecord: derives plain text from html, sanitizes, needs an id and a message', () => {
  const r = rec();
  assert.equal(r.messages[1].text, 'Use sorted()\n\nsorted(x)');
  assert.equal(r.messages[0].html, undefined);
  assert.equal(makeRecord({ id: null, conversation: conv }), null, 'unsaved chat without id');
  assert.equal(makeRecord({ id: 'abc123', conversation: { messages: [] } }), null);
});

test('sanitizeRecord: hostile payloads are neutralised and limits applied', () => {
  const r = sanitizeRecord({ id: 'x1', title: '\u0000<t>', path: '//evil.com', messages: [
    { role: 'assistant', html: '<p>ok</p><script>alert(1)</script><img src=x onerror=1>' },
    { role: 'weird', text: 'hi' }, 7, { role: 'user', text: '   ' },
  ] });
  assert.equal(r.path, null);
  assert.equal(r.messages.length, 2);
  assert.equal(r.messages[0].html, '<p>ok</p>');
  assert.equal(r.messages[1].role, 'assistant', 'unknown role falls back safely');
  for (const bad of [null, [], { id: 'a b', messages: [{ text: 'x' }] }, { id: 'ok1234', messages: [] }, { id: 'ok1234' }]) assert.equal(sanitizeRecord(bad), null);
});

test('recordSignature: changes with content, stable otherwise', () => {
  const a = rec();
  assert.equal(recordSignature(a), recordSignature(rec()));
  const b = rec();
  b.messages[0].text += '!';
  assert.notEqual(recordSignature(a), recordSignature(b));
});

test('markdown: user text is quoted (so "# x" cannot become a heading), assistant keeps structure', () => {
  assert.equal(recordToMarkdown(rec(), { labels }),
    '# Sorting <b>\n\n## You\n\n> sort a list\n> # not a heading\n\n## Gemini\n\nUse `sorted()`\n\n```python\nsorted(x)\n```\n');
});

test('html document: standalone, escaped, no script, TOC for several chats', () => {
  const html = recordsToHtml([rec(), { ...rec(), id: 'zzz999', title: 'Two' }], { title: 'All <chats>', labels, toc: true, tocLabel: 'Contents' });
  assert.match(html, /<title>All &lt;chats&gt;<\/title>/);
  assert.match(html, /<nav class="toc">.*href="#chat-2"/s);
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /<div class="txt">sort a list\n# not a heading<\/div>/);
  assert.match(html, /<h2 id="chat-1">Sorting &lt;b&gt;<\/h2>/);
});

const SAVED = { bookmarks: [{ snippet: 'Key *idea*', role: 'assistant', note: 'line one\nline two' }], highlights: [{ quote: 'quoted <text>', note: 'why' }, { quote: 'no note' }] };

test('sanitizeSaved: shape, limits, junk dropped, null when empty', () => {
  assert.deepEqual(sanitizeSaved(SAVED), SAVED);
  assert.equal(sanitizeSaved(null), null);
  assert.equal(sanitizeSaved({ bookmarks: [{ snippet: '' }], highlights: [{ quote: '  ' }, 5] }), null);
  assert.equal(sanitizeSaved({ highlights: Array.from({ length: 500 }, (_, i) => ({ quote: `q${i}` })) }).highlights.length, 200);
  assert.equal(sanitizeSaved({ bookmarks: [{ snippet: 's', role: 'weird' }] }).bookmarks[0].role, 'assistant');
});

test('records carry saved items, and a changed note changes the signature (so it is re-saved and re-indexed)', () => {
  const base = { id: 'abc123', title: 'T', messages: [{ role: 'user', text: 'hi' }], saved: SAVED };
  const a = sanitizeRecord(base);
  assert.deepEqual(a.saved, SAVED);
  assert.equal('saved' in sanitizeRecord({ ...base, saved: null }), false);
  const b = sanitizeRecord({ ...base, saved: { ...SAVED, highlights: [{ quote: 'quoted <text>', note: 'edited' }] } });
  assert.notEqual(recordSignature(a), recordSignature(b));
  assert.equal(recordSignature(sanitizeRecord({ ...base, saved: undefined })), recordSignature(sanitizeRecord({ id: 'abc123', title: 'T', messages: [{ role: 'user', text: 'hi' }] })), 'records without saved items keep their old signature');
});

test('markdown / obsidian / html carry the saved section, escaped, with notes', () => {
  const r = sanitizeRecord({ id: 'abc123', title: 'T', messages: [{ role: 'user', text: 'hi' }], saved: SAVED });
  const md = recordToMarkdown(r, { labels: { ...labels, saved: 'Saved items', note: 'Note' } });
  assert.match(md, /## Saved items\n\n- ★ Key \\\*idea\\\*\n  - \*Note:\* line one\n    line two\n- \*“quoted \\<text>”\*\n  - \*Note:\* why\n- \*“no note”\*/);
  assert.match(recordToMarkdown(r, { labels }), /## Saved\n/, 'labels fall back when a caller passes only roles');
  assert.equal(savedMarkdown({ bookmarks: [], highlights: [] }), '');
  const html = recordsToHtml([r], { title: 'T', labels });
  assert.match(html, /<div class="saved"><h3>Saved<\/h3>/);
  assert.match(html, /quoted &lt;text&gt;/);
  assert.doesNotMatch(html, /<script/);
  assert.equal(recordToMarkdown(sanitizeRecord({ id: 'abc123', title: 'T', messages: [{ role: 'user', text: 'hi' }] }), { labels }).includes('Saved'), false);
});
