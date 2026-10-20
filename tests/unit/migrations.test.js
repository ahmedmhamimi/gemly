import test from 'node:test';
import assert from 'node:assert/strict';
import { MIGRATIONS, SCHEMA_VERSION, runMigrations, storedVersion, validateMigrations } from '../../src/content/core/migrations.js';
import { BACKUP_KEY, STORAGE_KEYS } from '../../src/content/core/config.js';

const VK = STORAGE_KEYS.schemaVersion;
const KEYS = ['k-folders', 'k-prompts', 'k-gone'];
const opts = (migrations, target) => ({ dataKeys: KEYS, versionKey: VK, migrations, target });

const upper = (key) => (d) => {
  if (Array.isArray(d[key])) d[key].forEach((f) => (f.name = String(f.name).toUpperCase())); // tolerant of garbage
};
const step2 = { to: 2, name: 'rename-folders', up: upper('k-folders') };
const step3 = { to: 3, name: 'drop-gone', up: (d) => void delete d['k-gone'] };

test('production list is valid and SCHEMA_VERSION matches its last step', () => {
  assert.ok(validateMigrations(MIGRATIONS, SCHEMA_VERSION));
  assert.equal(SCHEMA_VERSION, 1 + MIGRATIONS.length);
});

test('validateMigrations: gaps, wrong order and a stale target are rejected', () => {
  assert.throws(() => validateMigrations([{ ...step3 }]), /not contiguous/);
  assert.throws(() => validateMigrations([step3, step2]), /not contiguous/);
  assert.throws(() => validateMigrations([step2], 5), /does not match/);
  assert.throws(() => validateMigrations([{ to: 2, up() {} }]), /not contiguous/); // no name
  assert.ok(validateMigrations([]));
});

test('storedVersion: absent / garbled -> 1', () => {
  for (const v of [undefined, null, 0, -3, 1.5, '2', NaN]) assert.equal(storedVersion({ [VK]: v }, VK), 1);
  assert.equal(storedVersion({ [VK]: 4 }, VK), 4);
  assert.equal(storedVersion(null, VK), 1);
});

test('nothing to do at the current version: no writes, input untouched', () => {
  const raw = { [VK]: 1, 'k-folders': [{ name: 'a' }] };
  const r = runMigrations(raw, opts([], 1));
  assert.deepEqual([r.ok, r.applied, r.writes, r.removes], [true, [], {}, []]);
  assert.deepEqual(raw, { [VK]: 1, 'k-folders': [{ name: 'a' }] });
});

test('legacy install (no version key) runs every step in order and reports exactly what changed', () => {
  const raw = { 'k-folders': [{ name: 'a' }], 'k-prompts': [{ id: 'p' }], 'k-gone': { x: 1 } };
  const snapshot = structuredClone(raw);
  const r = runMigrations(raw, opts([step2, step3], 3));
  assert.equal(r.ok, true);
  assert.equal(r.from, 1);
  assert.equal(r.to, 3);
  assert.deepEqual(r.applied, ['rename-folders', 'drop-gone']);
  assert.deepEqual(r.writes, { 'k-folders': [{ name: 'A' }] }, 'untouched keys are not rewritten');
  assert.deepEqual(r.removes, ['k-gone']);
  assert.deepEqual(r.before, { 'k-folders': [{ name: 'a' }], 'k-gone': { x: 1 } }, 'backup holds the old values');
  assert.deepEqual(raw, snapshot, 'the caller input is never mutated');
});

test('only steps above the stored version run', () => {
  const r = runMigrations({ [VK]: 2, 'k-folders': [{ name: 'a' }], 'k-gone': 1 }, opts([step2, step3], 3));
  assert.deepEqual(r.applied, ['drop-gone']);
  assert.deepEqual(r.writes, {});
  assert.deepEqual(r.removes, ['k-gone']);
});

test('idempotent: running the steps again over migrated data changes nothing further', () => {
  const first = runMigrations({ 'k-folders': [{ name: 'a' }] }, opts([step2], 2));
  const again = runMigrations({ [VK]: 1, ...first.writes }, opts([step2], 2));
  assert.deepEqual(again.writes, {}, 'uppercasing already-uppercase names is a no-op');
});

test('a throwing step: ok=false, nothing to write, stored data stays as it was', () => {
  const bad = { to: 3, name: 'boom', up: () => { throw new Error('boom'); } };
  const raw = { 'k-folders': [{ name: 'a' }] };
  const r = runMigrations(raw, opts([step2, bad], 3));
  assert.equal(r.ok, false);
  assert.match(r.error.message, /boom/);
  assert.deepEqual([r.writes, r.removes, r.applied, r.to], [{}, [], [], 1], 'even step 2 is not persisted');
  assert.deepEqual(raw, { 'k-folders': [{ name: 'a' }] });
});

test('garbled stored values do not crash a step that tolerates them', () => {
  const r = runMigrations({ 'k-folders': 'not-an-array' }, opts([step2], 2));
  assert.equal(r.ok, true);
  assert.deepEqual(r.writes, {});
});

test('data from a NEWER build is left alone (downgrade)', () => {
  const r = runMigrations({ [VK]: 9, 'k-folders': [{ name: 'a' }] }, opts([step2], 2));
  assert.equal(r.newer, true);
  assert.deepEqual([r.applied, r.writes, r.removes], [[], {}, []]);
});

// --------------------------------------------------------------- Store wiring

const mkChrome = (mem, { failSet = false } = {}) => {
  globalThis.chrome = {
    runtime: { id: 'test' },
    storage: {
      local: {
        get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => k in mem).map((k) => [k, structuredClone(mem[k])])),
        set: async (o) => {
          if (failSet) throw new Error('QUOTA_BYTES quota exceeded');
          for (const [k, v] of Object.entries(o)) mem[k] = structuredClone(v);
        },
        remove: async (keys) => (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete mem[k]),
      },
      onChanged: { addListener() {}, removeListener() {} },
    },
  };
};
const stubDom = () => {
  globalThis.window ??= globalThis;
  globalThis.document ??= { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  globalThis.window.addEventListener ??= () => {};
  globalThis.window.removeEventListener ??= () => {};
};
stubDom();
const { Store } = await import('../../src/content/core/store.js');
const { bus } = await import('../../src/content/core/events.js');
const FOLDERS = STORAGE_KEYS.folders;
const storeStep = { to: 2, name: 'rename-folders', up: upper(FOLDERS) };
test.beforeEach(() => Store.dispose()); // a failed assertion must never leak a loaded Store into the next test
const quiet = async (fn) => {
  const [w, e] = [console.warn, console.error];
  console.warn = console.error = () => {};
  try {
    return await fn();
  } finally {
    [console.warn, console.error] = [w, e];
  }
};

test('Store.load migrates a legacy install: data, version stamp and backup land together', async () => {
  const mem = { [FOLDERS]: [{ id: 'f1', name: 'work', color: '#4f7cff' }] };
  mkChrome(mem);
  Store._migrationOpts = { migrations: [storeStep], target: 2 };
  await Store.load();
  assert.equal(Store.get('folders')[0].name, 'WORK');
  assert.equal(mem[VK], 2);
  assert.equal(mem[FOLDERS][0].name, 'WORK', 'persisted');
  assert.equal(mem[BACKUP_KEY].from, 1);
  assert.equal(mem[BACKUP_KEY].data[FOLDERS][0].name, 'work', 'one-slot backup of the old value');
  Store.dispose();
});

test('Store.load: a failing step leaves storage untouched, the Store still loads, and the failure is announced', async () => {
  const mem = { [FOLDERS]: [{ id: 'f1', name: 'keep', color: '#4f7cff' }] };
  mkChrome(mem);
  Store._migrationOpts = { migrations: [{ to: 2, name: 'boom', up: () => { throw new Error('nope'); } }], target: 2 };
  const seen = [];
  const off = bus.on('migration-error', (e) => seen.push(e));
  await quiet(() => Store.load());
  off();
  assert.equal(Store.get('folders')[0].name, 'keep');
  assert.equal(VK in mem, false, 'version not stamped');
  assert.equal(BACKUP_KEY in mem, false);
  assert.equal(seen.length, 1);
  Store.dispose();
});

test('Store.load: if persisting the migration fails (quota) memory still holds the migrated data and load does not throw', async () => {
  const mem = { [FOLDERS]: [{ id: 'f1', name: 'x', color: '#4f7cff' }] };
  mkChrome(mem, { failSet: true });
  Store._migrationOpts = { migrations: [storeStep], target: 2 };
  await quiet(() => Store.load());
  assert.equal(Store.get('folders')[0].name, 'X');
  assert.equal(mem[FOLDERS][0].name, 'x', 'storage unchanged, so the step re-runs next load');
  Store.dispose();
});

test('Store.load: no migration pending means no extra storage write', async () => {
  let writes = 0;
  const mem = { [FOLDERS]: [{ id: 'f1', name: 'a', color: '#4f7cff' }] };
  mkChrome(mem);
  const set = chrome.storage.local.set;
  chrome.storage.local.set = async (o) => (writes++, set(o));
  Store._migrationOpts = {};
  await Store.load();
  assert.equal(writes, 0);
  assert.deepEqual(Store.get('features'), {}, 'the new features entry defaults to empty');
  Store.dispose();
});
