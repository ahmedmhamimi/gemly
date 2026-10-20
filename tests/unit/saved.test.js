import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeBookmarks, sanitizeHighlights, cleanNote } from '../../src/content/core/schema.js';
import { locateAll, locateQuote, occurrenceAt } from '../../src/content/features/saved/locate.js';

globalThis.window ??= globalThis;
globalThis.document ??= { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
globalThis.window.addEventListener ??= () => {};
globalThis.window.removeEventListener ??= () => {};
const mem = {};
globalThis.chrome = { runtime: { id: 't' }, storage: { local: {
  get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => k in mem).map((k) => [k, structuredClone(mem[k])])),
  set: async (o) => Object.assign(mem, structuredClone(o)), remove: async () => {} }, onChanged: { addListener() {}, removeListener() {} } } };
const { Store } = await import('../../src/content/core/store.js');
const m = await import('../../src/content/features/saved/model.js');

test.beforeEach(async () => { Store.dispose(); for (const k of Object.keys(mem)) delete mem[k]; await Store.load(); });

test('cleanNote and the bookmark note field (additive: old bookmarks without a note still load)', () => {
  assert.equal(cleanNote('  a\r\nb\u0000c  '), 'a\nbc');
  assert.equal(cleanNote(5), '');
  assert.equal(cleanNote('x'.repeat(900)).length, 500);
  const b = sanitizeBookmarks({ c1: [{ key: 'k1', role: 'user', snippet: 'S', addedAt: 1, note: ' hi ' }, { key: 'k2', snippet: 'T', addedAt: 2 }] });
  assert.equal(b.c1[0].note, 'hi');
  assert.equal('note' in b.c1[1], false);
});

test('sanitizeHighlights: shape, limits, dedupe, junk dropped', () => {
  const h = sanitizeHighlights({ c1: [
    { id: 'h1', key: 'k', quote: '  some   quoted\ntext ', occ: 2, note: 'n', createdAt: 5 },
    { id: 'h1', key: 'k', quote: 'dup id' }, { id: 'h2', key: '', quote: 'no key' }, { id: 'h3', key: 'k', quote: '   ' }, { id: 'bad id', key: 'k', quote: 'x' }, null,
    { id: 'h4', key: 'k', quote: 'q', occ: -3 },
  ], 'bad conv': [{ id: 'h9', key: 'k', quote: 'x' }], c2: 'no' });
  assert.deepEqual(h.c1.map((x) => [x.id, x.quote, x.occ]), [['h1', 'some quoted text', 2], ['h4', 'q', 0]]);
  assert.deepEqual(Object.keys(h), ['c1']);
  assert.equal(sanitizeHighlights({ c1: Array.from({ length: 300 }, (_, i) => ({ id: `h${i}`, key: 'k', quote: `q${i}` })) }).c1.length, 200);
});

test('locateQuote: whitespace- and node-boundary-insensitive, correct offsets in the ORIGINAL chunks', () => {
  const chunks = ['The quick ', 'brown', ' fox\n', 'jumps  over the lazy dog'];
  const r = locateQuote(chunks, 'brown fox jumps');
  assert.deepEqual(r, { start: { chunk: 1, offset: 0 }, end: { chunk: 3, offset: 5 } });
  assert.equal(chunks[1].slice(r.start.offset), 'brown');
  assert.deepEqual(locateQuote(['hel', 'lo wor', 'ld'], 'hello world'), { start: { chunk: 0, offset: 0 }, end: { chunk: 2, offset: 2 } }, 'a word split by inline markup');
  assert.equal(locateQuote(chunks, 'purple'), null);
  assert.equal(locateQuote(chunks, '   '), null);
  assert.equal(locateQuote([], 'x'), null);
});

test('repeated quotes: the right occurrence is found and remembered', () => {
  const chunks = ['go go go'];
  assert.equal(locateAll(chunks, 'go').length, 3);
  assert.deepEqual(locateQuote(chunks, 'go', 2).start, { chunk: 0, offset: 6 });
  assert.equal(occurrenceAt(chunks, 'go', 0, 3), 1);
  assert.equal(occurrenceAt(chunks, 'go', 0, 99), 0, 'unknown position falls back to the first');
  assert.deepEqual(locateQuote(chunks, 'go', 9).start, { chunk: 0, offset: 0 }, 'a message that changed falls back to the first occurrence');
});

test('addHighlight: normalises, dedupes, caps; remove / setNote', () => {
  const a = m.addHighlight('c1', { key: 'k1', quote: '  hello   world ', note: ' n ' });
  assert.deepEqual([a.quote, a.note], ['hello world', 'n']);
  assert.equal(m.addHighlight('c1', { key: 'k1', quote: 'hello world' }).id, a.id, 'same quote on the same message is not added twice');
  assert.equal(m.addHighlight('c1', { key: 'k1', quote: '   ' }), null);
  assert.equal(m.addHighlight(null, { key: 'k1', quote: 'x' }), null);
  assert.equal(m.setNote('highlight', 'c1', a.id, ''), true);
  assert.equal('note' in m.highlightsOf('c1')[0], false);
  assert.equal(m.setNote('highlight', 'c1', 'ghost', 'x'), false);
  m.removeHighlight('c1', a.id);
  assert.deepEqual(Store.get('highlights'), {});
  for (let i = 0; i < 205; i++) m.addHighlight('c2', { key: 'k', quote: `q${i}` });
  assert.equal(m.highlightsOf('c2').length, 200);
});

test('listSaved / filterSaved / savedForChat combine bookmarks and highlights', () => {
  Store.update('bookmarks', (b) => void (b.c1 = [{ key: 'k1', role: 'assistant', snippet: 'Star snippet', addedAt: 10 }]));
  m.setNote('bookmark', 'c1', 'k1', 'remember this');
  m.addHighlight('c1', { key: 'k1', quote: 'a quote', note: 'why' });
  m.addHighlight('c2', { key: 'k9', quote: 'other chat' });
  const all = m.listSaved();
  assert.equal(all.length, 3);
  assert.deepEqual(m.listSaved('c1').map((i) => i.type).sort(), ['bookmark', 'highlight']);
  assert.deepEqual(m.filterSaved(all, 'WHY').map((i) => i.text), ['a quote']);
  assert.deepEqual(m.filterSaved(all, 'remember').map((i) => i.type), ['bookmark']);
  assert.equal(m.filterSaved(all, '').length, 3);
  assert.deepEqual(m.savedForChat('c1'), { bookmarks: [{ snippet: 'Star snippet', role: 'assistant', note: 'remember this' }], highlights: [{ quote: 'a quote', note: 'why' }] });
  assert.equal(m.savedForChat('nothing'), null);
  m.removeBookmark('c1', 'k1');
  assert.deepEqual(Store.get('bookmarks'), {});
});
