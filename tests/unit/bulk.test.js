import test from 'node:test';
import assert from 'node:assert/strict';
import { folderPathOf, frontMatter, noteName, recordToObsidian, tagOf, uniqueNames } from '../../src/content/features/export/serialize/obsidian.js';
import { makeRecord } from '../../src/content/features/export/serialize/record.js';

const labels = { user: 'You', assistant: 'Gemini' };
const rec = (id, title) => makeRecord({ id, title, path: `/app/${id}`, capturedAt: Date.UTC(2026, 0, 2), conversation: { messages: [
  { role: 'user', content: 'hi', isHTML: false }, { role: 'assistant', content: '<p>hello <strong>there</strong></p>', isHTML: true }] } });
const folders = [{ id: 'f1', name: 'Work', color: '#4f7cff' }, { id: 'f2', name: 'Q4: Plans', color: '#4f7cff', parentId: 'f1' }];

test('noteName: wikilink-breaking characters removed, reserved names and empties fall back, capped', () => {
  assert.equal(noteName('Plan: [Q4] #1 | a/b^c?'), 'Plan Q4 1 a b c');
  assert.equal(noteName('CON'), 'Chat');
  assert.equal(noteName('  ...  '), 'Chat');
  assert.equal(noteName('\u202eevil\u200b'), 'evil');
  assert.equal(Array.from(noteName('x'.repeat(300))).length, 100);
  assert.equal(noteName('😀'.repeat(150)).length, 200, 'cut by code points, no half emoji');
});

test('uniqueNames is case-insensitive and stable', () => {
  assert.deepEqual(uniqueNames(['A', 'a', 'A', 'B']), ['A', 'a (2)', 'A (3)', 'B']);
});

test('tagOf: obsidian-valid or empty', () => {
  assert.equal(tagOf('My Folder!'), 'my-folder');
  assert.equal(tagOf('2024'), '');
  assert.equal(tagOf('Работа'), 'работа');
  assert.equal(tagOf('###'), '');
});

test('front matter is valid-looking YAML with quoted/escaped strings', () => {
  const fm = frontMatter({ title: 'He said "hi"\nbye', id: 'abc123', url: 'https://x/app/abc123', folders: ['Work', 'Q4 Plans'], messages: 2, capturedAt: Date.UTC(2026, 0, 2) });
  assert.match(fm, /^---\ntitle: "He said \\"hi\\"\\nbye"\n/);
  assert.match(fm, /tags: \[gemly, work, q4-plans\]/);
  assert.match(fm, /captured: 2026-01-02T00:00:00.000Z/);
  assert.ok(fm.endsWith('\n---'));
});

test('obsidian note: front matter, no H1, role headings', () => {
  const md = recordToObsidian(rec('abc123', 'T'), { labels, folders: ['Work'], origin: 'https://gemini.google.com', exportedAt: 'E' });
  assert.match(md, /^---\n/);
  assert.match(md, /url: "https:\/\/gemini.google.com\/app\/abc123"/);
  assert.doesNotMatch(md.split('---\n').pop(), /^# /m);
  assert.match(md, /## You\n\n> hi\n\n## Gemini\n\nhello \*\*there\*\*/);
});

test('folderPathOf: root->leaf, tolerates cycles and missing folders', () => {
  assert.deepEqual(folderPathOf('a', { folders, assignments: { a: 'f2' } }), ['Work', 'Q4: Plans']);
  assert.deepEqual(folderPathOf('a', { folders, assignments: {} }), []);
  const cyc = [{ id: 'x', name: 'X', parentId: 'y' }, { id: 'y', name: 'Y', parentId: 'x' }];
  assert.ok(folderPathOf('a', { folders: cyc, assignments: { a: 'x' } }).length <= 16);
});

