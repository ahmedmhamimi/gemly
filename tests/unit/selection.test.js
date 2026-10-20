import test from 'node:test';
import assert from 'node:assert/strict';
import { SelectionState, rangeBetween } from '../../src/content/features/bulk/selection.js';

const order = ['a', 'b', 'c', 'd', 'e'];

test('rangeBetween: inclusive, either direction, unknown anchor -> just the target, unknown target -> nothing', () => {
  assert.deepEqual(rangeBetween(order, 'b', 'd'), ['b', 'c', 'd']);
  assert.deepEqual(rangeBetween(order, 'd', 'b'), ['b', 'c', 'd']);
  assert.deepEqual(rangeBetween(order, null, 'c'), ['c']);
  assert.deepEqual(rangeBetween(order, 'a', 'zzz'), []);
  assert.deepEqual(rangeBetween(order, 'c', 'c'), ['c']);
});

test('toggle / has / size / clear and change notifications', () => {
  const s = new SelectionState();
  let n = 0;
  const off = s.subscribe(() => n++);
  s.toggle('a'); s.toggle('b'); s.toggle('a');
  assert.deepEqual([s.ids(), s.size, s.has('b'), n], [['b'], 1, true, 3]);
  s.clear(); s.clear();
  assert.equal(n, 4, 'clearing an empty selection does not notify');
  off(); s.toggle('x');
  assert.equal(n, 4, 'unsubscribed');
});

test('shift range selects from the last toggled chat; shift on a selected chat deselects the range', () => {
  const s = new SelectionState();
  s.toggle('b');
  s.toggleRange('d', order);
  assert.deepEqual(s.ids().sort(), ['b', 'c', 'd']);
  s.toggleRange('c', order); // the anchor is now d; c is selected -> the d..c range is turned off
  assert.deepEqual(s.ids(), ['b']);
});

test('turning selection mode off clears the selection; a throwing subscriber cannot break it', () => {
  const s = new SelectionState();
  s.subscribe(() => { throw new Error('boom'); });
  let ok = 0;
  s.subscribe(() => ok++);
  s.setOn(true); s.toggle('a'); s.setOn(false);
  assert.deepEqual([s.on, s.size], [false, 0]);
  assert.ok(ok >= 3, 'later subscribers still run');
  s.setOn(false); // no change -> no notify
});

test('remove() drops ids (deleted chats) and notifies only on change; set() replaces', () => {
  const s = new SelectionState();
  s.set(['a', 'b', 'c']);
  let n = 0; s.subscribe(() => n++);
  s.remove(['b', 'zzz']);
  assert.deepEqual(s.ids(), ['a', 'c']);
  s.remove(['zzz']);
  assert.equal(n, 1);
});
