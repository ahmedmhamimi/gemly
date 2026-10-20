import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window ??= globalThis;
globalThis.document ??= { addEventListener() {}, removeEventListener() {}, documentElement: {}, querySelectorAll: () => [] };
globalThis.chrome ??= { runtime: { id: 'test' } };
const { nextFocusIndex } = await import('../../src/content/ui/modal.js');
const { rowState } = await import('../../src/content/features/settings/features-section.js');
const { Features } = await import('../../src/content/core/feature-registry.js');

test('focus trap wraps in both directions and handles empty / unfocused states', () => {
  assert.equal(nextFocusIndex(3, 2, false), 0);
  assert.equal(nextFocusIndex(3, 0, true), 2);
  assert.equal(nextFocusIndex(3, 1, false), 2);
  assert.equal(nextFocusIndex(3, -1, false), 0);
  assert.equal(nextFocusIndex(3, -1, true), 2);
  assert.equal(nextFocusIndex(0, -1, false), -1);
});

test('settings rows: locked, killed, user-off, dependency-off', () => {
  Features.reset();
  Features.define([{ id: 'base' }, { id: 'dep', requires: ['base'] }, { id: 'lock', locked: true }, { id: 'dead', enabled: false }]);
  Features.resolve({ base: false });
  const flags = new Map(Features.report().map((f) => [f.id, f]));
  const st = (id, ov) => rowState(Features.defs().find((d) => d.id === id), flags.get(id), ov, (x) => x);
  assert.deepEqual(st('lock', {}), { checked: true, disabled: true, note: 'locked' });
  assert.deepEqual(st('dead', {}), { checked: false, disabled: true, note: 'unavailable' });
  assert.deepEqual(st('base', { base: false }), { checked: false, disabled: false, note: null });
  assert.deepEqual(st('dep', { base: false }), { checked: true, disabled: false, note: 'needs:base' }, 'intent kept, reason shown');
  Features.reset();
});
