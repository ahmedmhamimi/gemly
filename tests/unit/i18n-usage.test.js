// Every i18n key the code asks for must exist. A typo would otherwise show the raw key to the person.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import en from '../../src/content/i18n/en.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.js') && !p.includes(`${path.sep}i18n${path.sep}`)) files.push(p);
  }
})(root);

const PLURAL = /^pdf\.messages$/; // looked up as base + .one/.few/...
const used = new Map(); // key -> first file
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\b(?:Lang\.t|Lang\.plural|\bt)\(\s*'([a-z][\w.-]*)'/g)) {
    if (!used.has(m[1])) used.set(m[1], path.relative(root, f));
  }
  // label/desc/tip keys stored in data tables: label: 'download.pdf.label', titleKey: '...'
  for (const m of src.matchAll(/\b(?:label|desc|title|tip|placeholder):\s*'((?:[a-z]+)\.[\w.-]+)'/g)) {
    if (en[m[1]] !== undefined || /\.(label|desc|title)$/.test(m[1])) used.set(m[1], used.get(m[1]) || path.relative(root, f));
  }
}

test('every statically referenced i18n key exists in en.js', () => {
  const missing = [];
  for (const [key, file] of used) {
    if (PLURAL.test(key)) continue;
    if (!(key in en)) missing.push(`${key}  (${file})`);
  }
  assert.deepEqual(missing, []);
  assert.ok(used.size > 150, `scanned ${used.size} keys`);
});

test('dynamic key families are complete (every code the code can produce has a message)', () => {
  const families = {
    'chain.error.': ['no-editor', 'composer-busy', 'send-failed', 'timeout', 'navigated'],
    'summary.error.': ['no-chat', 'navigated', 'empty-summary', 'composer-busy', 'send-failed', 'timeout', 'no-editor', 'generic'],
    'bulk.delete.fatal.': ['no-menu-button', 'no-delete-item', 'no-confirm'],
    'bulk.delete.code.': ['not-in-sidebar', 'still-present'],
    'prompts.import.err.': ['empty', 'json', 'format', 'newer', 'size'],
    'feature.': [], // filled below from the manifest test (every row has a title)
  };
  const missing = [];
  for (const [prefix, codes] of Object.entries(families)) for (const c of codes) if (!(`${prefix}${c}` in en)) missing.push(`${prefix}${c}`);
  assert.deepEqual(missing, []);
});
