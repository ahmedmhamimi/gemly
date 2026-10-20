import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, defaultValues, hasVariables, isChain, parse, promptSteps, render } from '../../src/content/features/prompts/template.js';

const NOW = new Date(2026, 9, 12, 14, 5);

test('plain text and unknown braces are left alone', () => {
  assert.equal(render('Hello world'), 'Hello world');
  assert.equal(render('{ one } and {{}} and {{ }} and {{a{b}}'), '{ one } and {{}} and {{ }} and {{a{b}}');
  assert.deepEqual(analyze(['no variables here']).variables, []);
  assert.equal(hasVariables(['x']), false);
});

test('text variable, default value, dropdown (first option is the default)', () => {
  const { variables } = analyze(['Explain {{topic}} in {{tone:formal|casual|playful}} style for {{audience=beginners}}.']);
  assert.deepEqual(variables, [
    { name: 'topic', kind: 'text', default: '', options: [] },
    { name: 'tone', kind: 'select', default: 'formal', options: ['formal', 'casual', 'playful'] },
    { name: 'audience', kind: 'text', default: 'beginners', options: [] },
  ]);
  assert.deepEqual(defaultValues(variables), { topic: '', tone: 'formal', audience: 'beginners' });
});

test('render: values win, missing ones fall back to the default, the same name is replaced everywhere', () => {
  const t = '{{who=World}}, hi {{who}}! {{mood:ok|great}}';
  assert.equal(render(t), 'World, hi World! ok');
  assert.equal(render(t, { who: 'Ann', mood: 'great' }), 'Ann, hi Ann! great');
  assert.equal(render('{{x}}', { x: '' }), '', 'an empty string is a real answer, not "missing"');
  assert.equal(render('{{x=d}}', { x: undefined }), 'd');
});

test('values are inserted literally (no re-expansion, no injection of further placeholders)', () => {
  assert.equal(render('A {{x}} B', { x: '{{y}} $& \\{{' }), 'A {{y}} $& \\{{ B');
});

test('escape: backslash-braces give a literal {{ and never become a variable', () => {
  assert.equal(render('Use \\{{name}} like this'), 'Use {{name}} like this');
  assert.deepEqual(analyze(['\\{{name}}']).variables, []);
});

test('one option is a default, not a dropdown; duplicate / empty options are dropped; whitespace is trimmed', () => {
  assert.deepEqual(analyze(['{{a: only }}']).variables[0], { name: 'a', kind: 'text', default: 'only', options: [] });
  assert.deepEqual(analyze(['{{a: x | x ||y }}']).variables[0].options, ['x', 'y']);
  assert.deepEqual(analyze(['{{ spaced name = hi }}']).variables[0], { name: 'spaced name', kind: 'text', default: 'hi', options: [] });
});

test('same name twice: the first definition wins, a later one only fills gaps; unicode names work', () => {
  const { variables } = analyze(['{{lang}} then {{lang=English}} and {{lang:fr|de}}', '{{язык=ru}}']);
  assert.equal(variables.length, 2);
  assert.deepEqual(variables[0], { name: 'lang', kind: 'select', default: 'English', options: ['fr', 'de'] });
  assert.equal(variables[1].name, 'язык');
});

test('built-ins are filled automatically and never asked', () => {
  const t = 'Today is {{date}} at {{time}} ({{datetime}}), {{DATE}}';
  assert.deepEqual(analyze([t]).variables, []);
  const out = render(t, {}, { now: NOW, locale: 'en' });
  assert.match(out, /October 12, 2026/);
  assert.match(out, /2:05\s?PM/);
  assert.equal(out.includes('{{'), false);
  assert.equal(render('{{date=whatever}}', {}, { now: NOW, locale: 'en' }).includes('2026'), true);
});

test('chains: variables are collected across ALL steps once; promptSteps / isChain', () => {
  const p = { content: 'Research {{topic}}', steps: ['Summarise in {{n=3}} bullets', 'Translate to {{lang:fr|de}} about {{topic}}'] };
  assert.deepEqual(analyze(promptSteps(p)).variables.map((v) => v.name), ['topic', 'n', 'lang']);
  assert.equal(isChain(p), true);
  assert.equal(isChain({ content: 'x' }), false);
  assert.equal(isChain({ content: 'x', steps: [] }), false);
  assert.deepEqual(promptSteps({ content: 'x' }), ['x']);
});

test('limits: at most 20 variables are asked and the caller is told; long names are not variables', () => {
  const many = Array.from({ length: 25 }, (_, i) => `{{v${i}}}`).join(' ');
  const r = analyze([many]);
  assert.equal(r.variables.length, 20);
  assert.equal(r.tooMany, true);
  assert.equal(analyze([`{{${'n'.repeat(41)}}}`]).variables.length, 0);
});

test('hostile / odd input does not hang or throw', () => {
  const t0 = Date.now();
  render('{{'.repeat(50000) + 'x' + '}}'.repeat(50000), {});
  render('{{a' + ' '.repeat(100000));
  assert.ok(Date.now() - t0 < 1500);
  assert.equal(render(null), '');
  assert.deepEqual(parse(''), []);
});
