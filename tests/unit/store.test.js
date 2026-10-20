import test from 'node:test';
import assert from 'node:assert/strict';
import { setupChrome, setupDom } from './env.js';

setupDom();
const sim = setupChrome();
const { Store, deepFreeze } = await import('../../src/content/core/store.js');
const { bus } = await import('../../src/content/core/events.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

sim.mem['gemly-folders-v1'] = [{ id: 'a', name: 'A', color: '#4f7cff' }, { id: 'a', name: 'dupe' }, 'garbage'];
sim.mem['gemly-tone-v1'] = 'corrupt';
await Store.load();

test('load sanitizes corrupt persisted data instead of crashing', () => {
  assert.equal(Store.get('folders').length, 1);
  assert.deepEqual(Store.get('tone'), { selectedId: 'none', customTones: [] });
  assert.equal(Store.get('prompts'), null);
});

test('get() returns a frozen shared snapshot; mutation throws', () => {
  const f = Store.get('folders');
  assert.ok(Object.isFrozen(f) && Object.isFrozen(f[0]));
  assert.throws(() => f.push({}), TypeError);
  assert.equal(Store.get('folders'), f, 'same reference - no per-read cloning');
});

test('update() mutates a clone, sanitizes, and commits', () => {
  Store.update('folders', (list) => void list.push({ id: 'b', name: '  New  ', color: 'bad' }));
  const f = Store.get('folders');
  assert.equal(f.length, 2);
  assert.equal(f[1].name, 'New');
  assert.match(f[1].color, /^#[0-9a-f]{6}$/);
});

test('writes are batched into one storage call per burst', async () => {
  await sleep(200);
  const before = sim.mem.__writes || 0;
  for (let i = 0; i < 25; i++) Store.update('folderState', (s) => void (s[`f${i}`] = true));
  await sleep(300);
  assert.equal((sim.mem.__writes || 0) - before, 1);
  assert.equal(Object.keys(sim.mem['gemly-folder-state-v1']).length, 25);
});

test('no-op updates do not write', async () => {
  await sleep(200);
  const before = sim.mem.__writes || 0;
  Store.update('folderState', () => {});
  Store.set('folderState', Store.get('folderState'));
  await sleep(250);
  assert.equal(sim.mem.__writes || 0, before);
});

test('echo of our own write is ignored; foreign change updates cache and emits', async () => {
  await sleep(200);
  let events = 0;
  const off = bus.on('store', () => events++);
  Store.update('toneLast', (m) => void (m.c1 = 'fun'));
  await sleep(250);
  assert.equal(events, 0, 'own write must not look like another tab');

  // another tab writes directly
  await chrome.storage.local.set({ 'gemly-tone-last-injected-v1': { c1: 'concise', c2: 'fun' } });
  assert.equal(events, 1);
  assert.equal(Store.get('toneLast').c1, 'concise');
  off();
});

test('quota failure is reported, not swallowed', async () => {
  const errors = [];
  const off = bus.on('store-error', (e) => errors.push(e));
  const origError = console.error;
  console.error = () => {};
  sim.fail('QUOTA_BYTES quota exceeded');
  Store.update('bookmarks', (b) => void (b.c1 = [{ key: 'k', role: 'user', snippet: 's' }]));
  await sleep(300);
  console.error = origError;
  sim.fail(null);
  off();
  assert.equal(errors.length, 1);
  assert.equal(errors[0].quota, true);
  assert.equal(Store.get('bookmarks').c1.length, 1, 'in-memory state stays usable');
});

test('flush() persists immediately', async () => {
  Store.update('toneLast', (m) => void (m.zzz = 'fun'));
  await Store.flush();
  assert.equal(sim.mem['gemly-tone-last-injected-v1'].zzz, 'fun');
});

test('unknown entry names throw (typo protection)', () => {
  assert.throws(() => Store.get('nope'));
  assert.throws(() => Store.update('nope', () => {}));
});

test('deepFreeze freezes nested structures once', () => {
  const o = deepFreeze({ a: { b: [1, { c: 2 }] } });
  assert.ok(Object.isFrozen(o.a.b[1]));
});
