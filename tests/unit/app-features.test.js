import test from 'node:test';
import assert from 'node:assert/strict';

// App's constructor only reads `location.href`; no DOM is needed to test feature gating.
globalThis.window ??= globalThis;
globalThis.document ??= { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
globalThis.location = { href: 'https://gemini.google.com/app', pathname: '/app', origin: 'https://gemini.google.com' };
globalThis.chrome ??= { runtime: { id: 'test' } };

const { App } = await import('../../src/content/core/app.js');
const { Features } = await import('../../src/content/core/feature-registry.js');
const { Store } = await import('../../src/content/core/store.js');

const mk = (id, extra = {}) => ({ id, zones: ['chat'], ...extra });

test('App refuses two features with the same id', () => {
  assert.throws(() => new App([mk('aa'), mk('aa')]), /Duplicate feature id "aa"/);
});

test('App drops features that the registry has switched off, keeps the rest in order, and reports them', () => {
  Features.reset();
  Features.define([{ id: 'aaa' }, { id: 'bbb', requires: ['aaa'] }, { id: 'ccc' }]);
  Store.set('features', { aaa: false }); // user switched aaa off; bbb requires it
  const app = new App([mk('aaa'), mk('bbb'), mk('ccc')]);
  app._applyFeatureFlags();
  assert.deepEqual(app.featureStatus().map((f) => f.id), ['ccc']);
  assert.deepEqual(app.inactive, [
    { id: 'aaa', reason: 'switched off in settings' },
    { id: 'bbb', reason: 'requires "aaa"' },
  ]);
  Store.set('features', {});
  Features.reset();
});

test('features the registry has never heard of stay enabled (fail open) so ad-hoc App lists keep working', () => {
  Features.reset();
  const app = new App([mk('adhoc')]);
  app._applyFeatureFlags();
  assert.deepEqual(app.featureStatus(), [{ id: 'adhoc', disabled: false, failures: 0 }], 'featureStatus() shape is unchanged');
  assert.deepEqual(app.inactive, []);
});

test('an inactive feature is not in the list that init() and scan() iterate', () => {
  Features.reset();
  Features.define([{ id: 'live' }, { id: 'dead', enabled: false }]);
  const app = new App([mk('live', { scan() {} }), mk('dead', { scan() {} })]);
  app._applyFeatureFlags();
  assert.deepEqual(app.features.map((f) => f.def.id), ['live']);
  assert.deepEqual(app.inactive.map((i) => i.reason), ['disabled in manifest']);
  // (The scan loop itself is exercised with a real DOM by tests/unit/app.test.js.)
  Features.reset();
});
