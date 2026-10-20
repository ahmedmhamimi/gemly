import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_ID, Features, resolveFlags, validateDefs } from '../../src/content/core/feature-registry.js';
import { sanitizeFeatureFlags } from '../../src/content/core/schema.js';

const quiet = (fn) => {
  const w = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = w;
  }
};

test('validateDefs: rejects bad ids, duplicates, unknown/self requires and mismatched app ids', () => {
  assert.throws(() => validateDefs([{ id: 'Bad_Id' }]), /invalid feature id/);
  assert.throws(() => validateDefs([{ id: 'a1' }, { id: 'a1' }]), /duplicate feature id "a1"/);
  assert.throws(() => validateDefs([{ id: 'aa', requires: ['nope'] }]), /unknown feature "nope"/);
  assert.throws(() => validateDefs([{ id: 'aa', requires: ['aa'] }]), /requires itself/);
  assert.throws(() => validateDefs([{ id: 'aa', app: { id: 'zz' } }]), /different id/);
  assert.throws(() => validateDefs('x'), /array/);
});

test('validateDefs: a requires cycle is rejected, a diamond is fine', () => {
  assert.throws(
    () => validateDefs([{ id: 'aa', requires: ['bb'] }, { id: 'bb', requires: ['cc'] }, { id: 'cc', requires: ['aa'] }]),
    /cycle/,
  );
  assert.ok(
    validateDefs([{ id: 'top' }, { id: 'left', requires: ['top'] }, { id: 'right', requires: ['top'] }, { id: 'base', requires: ['left', 'right'] }]),
  );
});

test('validateDefs: one widget/action/hook id cannot be owned by two features; same id in different kinds is fine', () => {
  assert.throws(() => validateDefs([{ id: 'aa', widgets: ['x'] }, { id: 'bb', widgets: ['x'] }]), /claimed by both/);
  assert.ok(validateDefs([{ id: 'aa', widgets: ['x'], hooks: ['x'], actions: ['x'] }]));
});

test('resolveFlags: defaults on; developer kill switch beats everything; users can only switch OFF', () => {
  const defs = [{ id: 'on' }, { id: 'killed', enabled: false }, { id: 'locked', locked: true }];
  const r = resolveFlags(defs, { on: false, killed: true, locked: false });
  assert.equal(r.get('on').enabled, false);
  assert.equal(r.get('on').source, 'override');
  assert.equal(r.get('killed').enabled, false, 'a user override cannot re-enable a killed feature');
  assert.equal(r.get('killed').source, 'config');
  assert.equal(r.get('locked').enabled, true, 'locked rows ignore overrides');
  assert.equal(resolveFlags(defs, {}).get('on').enabled, true);
  assert.equal(resolveFlags(defs).get('on').source, 'default');
});

test('resolveFlags: dependencies cascade to a fixpoint', () => {
  const defs = [{ id: 'base' }, { id: 'mid', requires: ['base'] }, { id: 'leaf', requires: ['mid'] }, { id: 'solo' }];
  const r = resolveFlags(defs, { base: false });
  assert.deepEqual(
    [...r].map(([id, f]) => [id, f.enabled]),
    [['base', false], ['mid', false], ['leaf', false], ['solo', true]],
  );
  assert.equal(r.get('leaf').source, 'dependency');
  assert.match(r.get('mid').reason, /requires "base"/);
});

test('registry: facets follow their owner; unknown ids and facets fail OPEN with a warning', () => {
  Features.reset();
  Features.define([
    { id: 'tone-x', widgets: ['chip'], hooks: ['tag'] },
    { id: 'other', actions: ['dl'] },
  ]);
  assert.equal(Features.isFacetEnabled('widget', 'chip'), true);
  Features.resolve({ 'tone-x': false });
  assert.equal(Features.isFacetEnabled('widget', 'chip'), false);
  assert.equal(Features.isFacetEnabled('hook', 'tag'), false);
  assert.equal(Features.isFacetEnabled('action', 'dl'), true);
  assert.equal(Features.ownerOf('widget', 'chip'), 'tone-x');
  assert.equal(Features.ownerOf('widget', 'ghost'), undefined);
  quiet(() => {
    assert.equal(Features.isEnabled('never-registered'), true);
    assert.equal(Features.isFacetEnabled('widget', 'ghost'), true);
  });
  assert.deepEqual(
    Features.filterFacets('widget', [{ id: 'chip' }, { id: 'ghost' }]).map((w) => w.id),
    ['ghost'],
  );
});

test('registry: version bumps on define/resolve (cache key) and report() describes every row', () => {
  Features.reset();
  const v0 = Features.version;
  Features.define([{ id: 'aa', locked: true }, { id: 'bb', requires: ['aa'] }]);
  const v1 = Features.version;
  Features.resolve({ bb: false });
  assert.ok(v1 > v0 && Features.version > v1);
  assert.deepEqual(Features.report(), [
    { id: 'aa', enabled: true, source: 'default', reason: null, locked: true },
    { id: 'bb', enabled: false, source: 'override', reason: 'switched off in settings', locked: false },
  ]);
  assert.equal(Features.reason('bb'), 'switched off in settings');
  Features.reset();
});

test('FEATURE_ID: kebab-case, starts with a letter', () => {
  for (const ok of ['bar', 'chat-search', 'a1']) assert.match(ok, FEATURE_ID);
  for (const bad of ['', 'x', 'Bar', '1ab', 'a_b', 'a b', 'a'.repeat(50)]) assert.doesNotMatch(bad, FEATURE_ID);
});

test('sanitizeFeatureFlags keeps only explicit false for valid ids, tolerates junk', () => {
  assert.deepEqual(sanitizeFeatureFlags(null), {});
  assert.deepEqual(sanitizeFeatureFlags([]), {});
  assert.deepEqual(sanitizeFeatureFlags({ tone: false, bar: true, 'Bad Id': false, x: false, folders: 0, 'chat-search': false }), {
    tone: false,
    'chat-search': false,
  });
  const many = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`feat-${i}`, false]));
  assert.equal(Object.keys(sanitizeFeatureFlags(many)).length, 200);
});
