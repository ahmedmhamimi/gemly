import test from 'node:test';
import assert from 'node:assert/strict';
import { setupChrome, setupDom } from './env.js';

setupDom('<!doctype html><html lang="en"><body class="dark-theme"></body></html>', 'https://gemini.google.com/app/abc123def456');
setupChrome();
globalThis.window.navigation = undefined;
const { App } = await import('../../src/content/core/app.js');
const { Store } = await import('../../src/content/core/store.js');
await Store.load();

const batch = { zones: new Set(['chat']), all: true };
const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

test('a throwing feature is isolated, then disabled after repeated failures; others keep running', async () => {
  const calls = { good: 0, bad: 0, torn: 0 };
  const app = new App([
    { id: 'bad', zones: ['chat'], scan() { calls.bad++; throw new Error('boom'); }, teardown() { calls.torn++; } },
    { id: 'good', zones: ['chat'], scan() { calls.good++; } },
  ]);
  await quiet(() => { for (let i = 0; i < 9; i++) app._runScan(batch); });
  assert.equal(calls.good, 9, 'good feature never skipped');
  assert.equal(calls.bad, 5, 'bad feature stopped after maxConsecutiveFailures');
  assert.equal(calls.torn, 1, 'torn down once when disabled');
  assert.deepEqual(app.featureStatus(), [{ id: 'bad', disabled: true, failures: 5 }, { id: 'good', disabled: false, failures: 0 }]);
});

test('a feature that recovers resets its failure count', async () => {
  let n = 0;
  const app = new App([{ id: 'flaky', zones: ['chat'], scan() { if (n++ % 2 === 0) throw new Error('x'); } }]);
  await quiet(() => { for (let i = 0; i < 20; i++) app._runScan(batch); });
  assert.equal(app.featureStatus()[0].disabled, false);
});

test('a failing init disables that feature immediately and never runs its scan', async () => {
  let scanned = 0;
  const app = new App([{ id: 'x', zones: ['chat'], init() { throw new Error('init fail'); }, scan() { scanned++; } }]);
  await quiet(() => app._guard(app.features[0], 'init', () => app.features[0].def.init(app.ctx)));
  app._runScan(batch);
  assert.equal(scanned, 0);
  assert.equal(app.featureStatus()[0].disabled, true);
});

test('scan only runs features whose zones are dirty (after their first mount)', () => {
  const ran = [];
  const app = new App([
    { id: 'sidebar', zones: ['sidebar'], scan() { ran.push('sidebar'); } },
    { id: 'chat', zones: ['chat'], scan() { ran.push('chat'); } },
  ]);
  app._runScan({ zones: new Set(), all: true });          // first mount: everyone
  ran.length = 0;
  app._runScan({ zones: new Set(['chat']), all: false });
  assert.deepEqual(ran, ['chat']);
  ran.length = 0;
  app._runScan({ zones: new Set(['global']), all: false });
  assert.deepEqual(ran, ['sidebar', 'chat'], 'global re-runs everything');
  ran.length = 0;
  app._runScan({ zones: new Set(['composer']), all: false });
  assert.deepEqual(ran, []);
});

test('a dead extension context shuts the instance down instead of throwing', () => {
  const app = new App([{ id: 'x', zones: [], scan() { throw new Error('should not run'); } }]);
  const id = chrome.runtime.id;
  delete chrome.runtime.id;
  app._runScan(batch);
  chrome.runtime.id = id;
  assert.equal(app._dead, true);
});

test('shutdown is idempotent and runs every cleanup exactly once', () => {
  let cleaned = 0;
  const app = new App([{ id: 'x', zones: [], init(ctx) { ctx.onDispose(() => cleaned++); } }]);
  app.features[0].def.init(app.ctx);
  app.shutdown('test');
  app.shutdown('again');
  assert.equal(cleaned, 1);
});
