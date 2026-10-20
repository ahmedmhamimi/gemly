import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window ??= globalThis;
globalThis.document ??= { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
globalThis.window.addEventListener ??= () => {};
globalThis.window.removeEventListener ??= () => {};
const mem = {};
globalThis.chrome = { runtime: { id: 't' }, storage: { local: {
  get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => k in mem).map((k) => [k, structuredClone(mem[k])])),
  set: async (o) => Object.assign(mem, structuredClone(o)), remove: async () => {} }, onChanged: { addListener() {}, removeListener() {} } } };
const { Store } = await import('../../src/content/core/store.js');
const m = await import('../../src/content/features/personas/model.js');

test.beforeEach(async () => { Store.dispose(); for (const k of Object.keys(mem)) delete mem[k]; await Store.load(); });

test('add: trims name, falls back to the text, rejects empty text, caps the library', () => {
  const a = m.addPersona({ name: '  Coach  ', text: 'Be brief.' });
  assert.equal(a.name, 'Coach');
  assert.equal(m.addPersona({ name: '', text: 'Explain things simply and kindly please' }).name, 'Explain things simply and kind'.slice(0, 30).trim());
  assert.equal(m.addPersona({ name: 'x', text: '   ' }), null);
  for (let i = 0; i < 60; i++) m.addPersona({ name: `p${i}`, text: 'x' });
  assert.equal(m.listPersonas().length, 50);
  assert.equal(m.addPersona({ name: 'over', text: 'x' }), null);
});

test('update / delete / active: unknown ids are ignored, deleting the active one clears it', () => {
  const a = m.addPersona({ name: 'A', text: 'one' });
  const b = m.addPersona({ name: 'B', text: 'two' });
  assert.equal(m.updatePersona(a.id, { name: 'A2', text: 'uno' }), true);
  assert.equal(m.updatePersona('ghost', { name: 'x', text: 'y' }), false);
  assert.equal(m.updatePersona(a.id, { name: 'x', text: ' ' }), false, 'empty text keeps the old one');
  assert.equal(m.listPersonas()[0].text, 'uno');
  m.setActivePersona(b.id);
  assert.equal(m.activePersona().name, 'B');
  m.setActivePersona('ghost');
  assert.equal(m.activePersona(), null);
  m.setActivePersona(b.id);
  m.deletePersona(b.id);
  assert.deepEqual([m.listPersonas().length, m.activePersona()], [1, null]);
});

test('autoSend is a strict boolean and survives a reload', async () => {
  m.setAutoSend('yes');
  assert.equal(Store.get('personas').autoSend, true);
  m.addPersona({ name: 'A', text: 'one' });
  Store.flush?.();
  await new Promise((r) => setTimeout(r, 400));
  Store.dispose();
  await Store.load();
  assert.equal(Store.get('personas').autoSend, true);
  assert.equal(m.listPersonas().length, 1);
});
