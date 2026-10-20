import test from 'node:test';
import assert from 'node:assert/strict';
import { codeBlocks, sanitizeHtml, tables, toMarkdown, toText } from '../../src/content/features/export/serialize/markup.js';

const code = '<div class="code-block"><div class="code-header">Python</div><pre><code>print(&quot;hi&quot;)\nx = 1 &lt; 2</code></pre></div>';

test('markdown: headings, paragraphs, emphasis, links, inline code, br', () => {
  const md = toMarkdown('<h2>Title</h2><p>Some <strong>bold</strong> and <em>it</em> <code class="inline-code">a`b</code> <a href="https://x.com/a b">link</a><br>next</p>');
  assert.equal(md, '## Title\n\nSome **bold** and *it* ``a`b`` [link](https://x.com/a%20b)  \nnext');
});

test('markdown: code fence carries language, keeps content verbatim, widens when code contains fences', () => {
  assert.equal(toMarkdown(code), '```python\nprint("hi")\nx = 1 < 2\n```');
  const nested = toMarkdown('<div class="code-block"><pre><code>```js\nx\n```</code></pre></div>');
  assert.equal(nested, '````\n```js\nx\n```\n````');
});

test('markdown: nested lists, ordered lists, blockquote, hr', () => {
  assert.equal(toMarkdown('<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>'), '- a\n  - b\n- c');
  assert.equal(toMarkdown('<ol><li>x</li><li>y</li></ol>'), '1. x\n2. y');
  assert.equal(toMarkdown('<blockquote><p>q1</p><p>q2</p></blockquote><hr>'), '> q1\n>\n> q2\n\n---');
});

test('markdown: tables become GFM with escaped pipes and ragged rows padded', () => {
  assert.equal(toMarkdown('<table><tr><th>A</th><th>B</th></tr><tr><td>1 | 2</td></tr></table>'), '| A | B |\n| --- | --- |\n| 1 \\| 2 |  |');
});

test('markdown: special characters are escaped, snake_case is not', () => {
  assert.equal(toMarkdown('<p>2 * 3 and snake_case and _lead [x] &lt;b&gt;</p>'), '2 \\* 3 and snake_case and \\_lead \\[x\\] \\<b>');
});

test('plain text: blocks separated by blank lines, lists, code, tables as TSV', () => {
  assert.equal(toText('<p>One</p><ul><li>a</li><li>b</li></ul>' + code + '<table><tr><td>1</td><td>2</td></tr></table>'),
    'One\n\n- a\n- b\n\nprint("hi")\nx = 1 < 2\n\n1\t2');
});

test('sanitizeHtml: scripts, handlers, javascript: links, images, unknown tags and attributes are removed', () => {
  const evil = '<p onclick="x()">hi<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">bad</a> <a href="https://ok.com" onclick="y()">good</a><iframe>t</iframe><style>p{}</style></p>';
  assert.equal(sanitizeHtml(evil), '<p>hibad <a href="https://ok.com">good</a>t</p>');
  assert.equal(sanitizeHtml('<p>&lt;script&gt;</p>'), '<p>&lt;script&gt;</p>', 'escaped text stays escaped');
  assert.equal(sanitizeHtml(null), '');
});

test('sanitizeHtml is idempotent and keeps the structure the extractor emits', () => {
  const html = `<h1>T</h1><p>x <strong>y</strong></p>${code}<table><tr><th>a</th></tr></table><ul><li>i</li></ul>`;
  const once = sanitizeHtml(html);
  assert.equal(once, html);
  assert.equal(sanitizeHtml(once), once);
});

test('hostile input: unclosed tags, stray <, deep nesting do not hang or throw', () => {
  const deep = '<div>'.repeat(5000) + 'x';
  assert.doesNotThrow(() => sanitizeHtml(deep));
  assert.doesNotThrow(() => toMarkdown('<p>a < b <p>c </div></ul>'));
  const t0 = Date.now();
  sanitizeHtml('<p>' + 'a<'.repeat(50000));
  assert.ok(Date.now() - t0 < 1000, 'linear time');
});

test('codeBlocks / tables extraction', () => {
  assert.deepEqual(codeBlocks('<p>x</p>' + code), [{ lang: 'Python', code: 'print("hi")\nx = 1 < 2' }]);
  assert.deepEqual(tables('<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>'), [[['a', 'b'], ['1', '2']]]);
  assert.deepEqual(codeBlocks('<p>none</p>'), []);
});
