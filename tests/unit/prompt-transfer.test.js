import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizePersonas, sanitizePrompts } from '../../src/content/core/schema.js';
import { buildExport, mergePersonas, mergePrompts, parseImport } from '../../src/content/features/prompts/transfer.js';

let n = 0;
const mkId = () => `new${++n}`;
const P = (title, content, steps) => ({ id: `p${title}`, title, content, createdAt: 1, ...(steps ? { steps } : {}) });

test('sanitizePrompts keeps chain steps (non-empty strings, max 9) and ordinary prompts stay unchanged', () => {
  const [a, b] = sanitizePrompts([{ id: 'a1', title: 'T', content: 'c', steps: ['s1', '', '  ', 5, 's2'] }, { id: 'b1', title: 'U', content: 'd' }]);
  assert.deepEqual(a.steps, ['s1', 's2']);
  assert.equal('steps' in b, false);
  assert.equal(sanitizePrompts([{ id: 'c1', content: 'x', steps: Array.from({ length: 20 }, (_, i) => `s${i}`) }])[0].steps.length, 9);
  assert.equal('steps' in sanitizePrompts([{ id: 'c1', content: 'x', steps: ['', ' '] }])[0], false);
});

test('sanitizePersonas: shape, limits, activeId must exist, autoSend strict boolean', () => {
  assert.deepEqual(sanitizePersonas(null), { items: [], activeId: null, autoSend: false });
  const r = sanitizePersonas({ items: [{ id: 'a1', name: ' Coach ', text: 'Be brief' }, { id: 'a1', name: 'dup', text: 'x' }, { id: 'b1', name: '', text: '   ' }, { id: 'c1', name: '', text: 'Long instruction here' }], activeId: 'c1', autoSend: 'yes' });
  assert.deepEqual(r.items.map((p) => [p.id, p.name]), [['a1', 'Coach'], ['c1', 'Long instruction here']]);
  assert.equal(r.activeId, 'c1');
  assert.equal(r.autoSend, false);
  assert.equal(sanitizePersonas({ items: [{ id: 'a1', text: 'x' }], activeId: 'zzz' }).activeId, null);
  assert.equal(sanitizePersonas({ items: Array.from({ length: 80 }, (_, i) => ({ id: `p${i}`, text: 'x' })) }).items.length, 50);
});

test('export is portable (no ids) and round-trips through import', () => {
  const out = buildExport({ prompts: [P('Plan', 'Plan {{topic}}', ['Refine it'])], personas: { items: [{ id: 'x1', name: 'Coach', text: 'Be brief', createdAt: 1 }] }, exportedAt: 'T' });
  assert.deepEqual(Object.keys(out.prompts[0]).sort(), ['content', 'steps', 'title']);
  assert.equal(JSON.stringify(out).includes('"id"'), false);
  const back = parseImport(JSON.stringify(out));
  assert.equal(back.ok, true);
  assert.deepEqual(back.prompts, [{ title: 'Plan', content: 'Plan {{topic}}', steps: ['Refine it'] }]);
  assert.deepEqual(back.personas, [{ name: 'Coach', text: 'Be brief' }]);
  assert.equal(back.skipped, 0);
});

test('import rejects garbage precisely and cleans hostile entries', () => {
  assert.equal(parseImport('').error, 'empty');
  assert.equal(parseImport('{x').error, 'json');
  assert.equal(parseImport('[1]').error, 'format');
  assert.equal(parseImport(JSON.stringify({ format: 'gemly-prompts', version: 7 })).error, 'newer');
  assert.equal(parseImport(' '.repeat(10) + 'x'.repeat(5 * 1024 * 1024 + 1)).error, 'size');
  const r = parseImport(JSON.stringify({ format: 'gemly-prompts', version: 1,
    prompts: [{ title: '<b>x</b>', content: 'ok' }, { content: '   ' }, null, 5, { title: 't', content: 'c', steps: 'nope' }], personas: [{ name: 'n', text: '' }, { text: 'ok' }] }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.prompts.map((p) => p.content), ['ok', 'c']);
  assert.equal(r.personas.length, 1);
  assert.equal(r.skipped, 3 + 1);
  assert.equal(parseImport(JSON.stringify({ format: 'gemly-prompts', version: 1 })).prompts.length, 0, 'missing arrays are fine');
});

test('mergePrompts: new first, identical ones skipped (case/space-insensitive), duplicates inside the file too', () => {
  const existing = [P('Plan', 'Plan  the day')];
  const r = mergePrompts(existing, [{ title: 'plan', content: 'plan the DAY' }, { title: 'New', content: 'x' }, { title: 'New', content: 'x' }, { title: 'Chain', content: 'a', steps: ['b'] }], mkId, 99);
  assert.equal(r.added, 2);
  assert.equal(r.duplicates, 2);
  assert.deepEqual(r.list.map((p) => p.title), ['New', 'Chain', 'Plan']);
  assert.equal(r.list[0].createdAt, 99);
  assert.notEqual(mergePrompts([], [{ title: 'Chain', content: 'a', steps: ['b'] }], mkId).list[0].id, undefined);
  assert.equal(mergePrompts([P('Chain', 'a', ['b'])], [{ title: 'Chain', content: 'a', steps: ['different'] }], mkId).added, 1, 'a different chain is not a duplicate');
});

test('mergePersonas: dedupes, appends, respects the cap', () => {
  const ex = [{ id: 'a1', name: 'Coach', text: 'Be brief', createdAt: 1 }];
  const r = mergePersonas(ex, [{ name: 'coach', text: 'be brief' }, { name: 'Tutor', text: 'Explain simply' }], mkId, 5);
  assert.deepEqual([r.added, r.duplicates, r.items.map((p) => p.name)], [1, 1, ['Coach', 'Tutor']]);
  assert.equal(mergePersonas(ex, [{ name: 'X', text: 'y' }], mkId, 5, 1).added, 0, 'cap reached');
});
