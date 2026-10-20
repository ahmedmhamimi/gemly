import test from 'node:test';
import assert from 'node:assert/strict';
import * as s from '../../src/content/core/schema.js';

test('folders: wrong types become empty, junk entries dropped', () => {
  assert.deepEqual(s.sanitizeFolders('nope'), []);
  assert.deepEqual(s.sanitizeFolders(null), []);
  const out = s.sanitizeFolders([null, 5, { id: '' }, { id: 'a b' }, { id: 'ok', name: 'X', color: 'red' }]);
  assert.equal(out.length, 1);
  assert.match(out[0].color, /^#[0-9a-f]{6}$/);
});

test('folders: duplicate ids, self-parent, orphan parent, cycles and over-deep chains are repaired', () => {
  const dup = s.sanitizeFolders([{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }]);
  assert.equal(dup.length, 1);

  const self = s.sanitizeFolders([{ id: 'a', name: 'A', parentId: 'a' }]);
  assert.equal(self[0].parentId, undefined);

  const orphan = s.sanitizeFolders([{ id: 'a', name: 'A', parentId: 'ghost' }]);
  assert.equal(orphan[0].parentId, undefined);

  const cyc = s.sanitizeFolders([{ id: 'a', name: 'A', parentId: 'b' }, { id: 'b', name: 'B', parentId: 'a' }]);
  assert.ok(cyc.some((f) => !f.parentId), 'at least one root after breaking the cycle');

  const chain = Array.from({ length: 20 }, (_, i) => ({ id: `f${i}`, name: `F${i}`, ...(i ? { parentId: `f${i - 1}` } : {}) }));
  const fixed = s.sanitizeFolders(chain);
  const byId = Object.fromEntries(fixed.map((f) => [f.id, f]));
  const depth = (f) => (f.parentId ? 1 + depth(byId[f.parentId]) : 0);
  assert.ok(Math.max(...fixed.map(depth)) < 8, 'depth capped');
});

test('folder names are cleaned and clamped; colors validated (no CSS injection)', () => {
  const [f] = s.sanitizeFolders([{ id: 'a', name: `<b>${'x'.repeat(200)}</b>\u0000`, color: 'red;background:url(x)' }]);
  assert.ok(f.name.length <= 48);
  assert.ok(!f.name.includes('\u0000'));
  assert.match(f.color, /^#[0-9a-f]{6}$/);
});

test('assignments / convMeta / folderState / toneLast reject bad shapes', () => {
  assert.deepEqual(s.sanitizeAssignments([1, 2]), {});
  assert.deepEqual(s.sanitizeAssignments({ 'bad key!': 'f', ok: 'f1', n: 5 }), { ok: 'f1' });
  const meta = s.sanitizeConvMeta({ a: { title: 'T', path: '//evil.com/x' }, b: { title: 'T', path: '/app/b' }, c: 'x' });
  assert.equal(meta.a.path, null); // protocol-relative URL refused
  assert.equal(meta.b.path, '/app/b');
  assert.equal(meta.c, undefined);
  assert.deepEqual(s.sanitizeFolderState({ a: true, b: 'yes', c: false }), { a: true });
  assert.deepEqual(s.sanitizeToneLast({ a: 'fun', b: 5 }), { a: 'fun' });
});

test('tone: unknown selection resets, custom tones deduped and clamped', () => {
  const t = s.sanitizeTone({ selectedId: 'ghost', customTones: [{ id: 'c1', label: 'x'.repeat(99) }, { id: 'c1', label: 'dup' }, { id: 'fun', label: 'clash' }, { id: 'c2', label: '' }] });
  assert.equal(t.selectedId, 'none');
  assert.equal(t.customTones.length, 1);
  assert.equal(t.customTones[0].label.length, 24);
  assert.deepEqual(s.sanitizeTone(5), { selectedId: 'none', customTones: [] });
  assert.equal(s.sanitizeTone({ selectedId: 'fun', customTones: [] }).selectedId, 'fun');
});

test('bookmarks: dedupes, clamps, drops empty conversations', () => {
  const out = s.sanitizeBookmarks({ c1: [{ key: 'k', role: 'x', snippet: 'hi' }, { key: 'k' }, { nokey: 1 }], c2: [], c3: 'nope' });
  assert.equal(out.c1.length, 1);
  assert.equal(out.c1[0].role, 'assistant');
  assert.equal(out.c2, undefined);
  assert.equal(out.c3, undefined);
  const many = s.sanitizeBookmarks({ c: Array.from({ length: 900 }, (_, i) => ({ key: `k${i}`, role: 'user', snippet: 's' })) });
  assert.equal(many.c.length, 500);
});

test('prompts: null (never saved) is distinct from [] (deleted all)', () => {
  assert.equal(s.sanitizePrompts(undefined), null);
  assert.equal(s.sanitizePrompts(null), null);
  assert.equal(s.sanitizePrompts('x'), null);
  assert.deepEqual(s.sanitizePrompts([]), []);
  const out = s.sanitizePrompts([{ id: 'a', title: 't', content: 'c' }, { id: 'a', content: 'dup' }, { id: 'b', content: '   ' }]);
  assert.equal(out.length, 1);
});
