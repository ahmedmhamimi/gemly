import test from 'node:test';
import assert from 'node:assert/strict';
import { Archive, MemoryBackend } from '../../src/background/archive.js';
import { makeRecord } from '../../src/content/features/export/serialize/record.js';

const rec = (id, text = 'hello', title = `Chat ${id}`) =>
  makeRecord({ id, title, path: `/app/${id}`, capturedAt: 1, conversation: { messages: [{ role: 'user', content: text, isHTML: false }, { role: 'assistant', content: `<p>${text} back</p>`, isHTML: true }] } });
const mk = () => new Archive(new MemoryBackend());

test('put / get / list / stats / delete / clear', async () => {
  const a = mk();
  assert.deepEqual(await a.putChats([rec('aaaaaa'), rec('bbbbbb')]), { saved: 2, unchanged: 0, rejected: 0 });
  assert.equal((await a.getChats(['aaaaaa', 'nope12', 'bbbbbb'])).length, 2, 'missing ids skipped');
  const rows = await a.list();
  assert.equal(rows.length, 2);
  assert.ok(!('messages' in rows[0]) || typeof rows[0].messages === 'number', 'list rows carry counts, not bodies');
  assert.equal((await a.stats()).count, 2);
  assert.deepEqual(await a.deleteChats(['aaaaaa']), { deleted: 1 });
  assert.equal((await a.stats()).count, 1);
  await a.clear();
  assert.equal((await a.stats()).count, 0);
});

test('unchanged chats are not rewritten; a changed one is', async () => {
  const a = mk();
  await a.putChats([rec('aaaaaa')]);
  assert.deepEqual(await a.putChats([rec('aaaaaa')]), { saved: 0, unchanged: 1, rejected: 0 });
  assert.deepEqual(await a.putChats([rec('aaaaaa', 'edited')]), { saved: 1, unchanged: 0, rejected: 0 });
  assert.deepEqual(await a.putChats([rec('aaaaaa', 'edited', 'Renamed')]), { saved: 1, unchanged: 0, rejected: 0 }, 'a rename alone is a change');
});

test('the worker re-sanitizes: hostile records are cleaned or rejected', async () => {
  const a = mk();
  const evil = { id: 'evil01', title: 't', messages: [{ role: 'assistant', html: '<p>x</p><script>1</script>' }] };
  const r = await a.putChats([evil, { id: 'bad id', messages: [] }, null]);
  assert.deepEqual(r, { saved: 1, unchanged: 0, rejected: 2 });
  assert.equal((await a.getChats(['evil01']))[0].messages[0].html, '<p>x</p>');
});

test('stored data is a copy: mutating a result never changes the archive', async () => {
  const a = mk();
  await a.putChats([rec('aaaaaa')]);
  (await a.getChats(['aaaaaa']))[0].title = 'hacked';
  assert.equal((await a.getChats(['aaaaaa']))[0].title, 'Chat aaaaaa');
});

test('handle(): whitelisted ops only, bad args tolerated, never throws', async () => {
  const a = mk();
  assert.equal((await a.handle('drop-database')).error, 'unknown-op');
  assert.equal((await a.handle('putChats', { records: 'nope' })).saved, 0);
  assert.equal((await a.handle('getChats', { ids: [1, null, '../x', 'okid12'] })).chats.length, 0);
  const broken = new Archive({ getMany: async () => { throw new Error('disk on fire'); } });
  assert.deepEqual(await broken.handle('putChats', { records: [rec('aaaaaa')] }), { ok: false, error: 'disk on fire' });
});

test('batch size is capped (a message cannot make the worker do unbounded work)', async () => {
  const a = mk();
  const many = Array.from({ length: 500 }, (_, i) => rec(`id${String(i).padStart(4, '0')}`));
  assert.equal((await a.putChats(many)).saved, 200);
});
