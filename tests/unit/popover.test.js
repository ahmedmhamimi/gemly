import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './env.js';

setupDom();
const { computePosition } = await import('../../src/content/ui/popover.js');
const vp = { width: 1000, height: 700 };
const rect = (o) => ({ top: 0, bottom: 0, left: 0, right: 0, ...o });

test('prefers above when it fits, flips below when it does not', () => {
  const low = computePosition(rect({ top: 600, bottom: 640, left: 100, right: 140 }), { width: 200, height: 300 }, vp);
  assert.equal(low.side, 'top');
  const high = computePosition(rect({ top: 50, bottom: 90, left: 100, right: 140 }), { width: 200, height: 300 }, vp);
  assert.equal(high.side, 'bottom');
});

test('always clamped inside the viewport', () => {
  const p = computePosition(rect({ top: 10, bottom: 40, left: 960, right: 990 }), { width: 400, height: 900 }, vp);
  assert.ok(p.left >= 8 && p.left + 400 <= vp.width - 8 + 0.1);
  assert.ok(p.top >= 8);
});

test('end alignment hugs the trailing edge; RTL mirrors start/end', () => {
  const a = rect({ top: 300, bottom: 330, left: 500, right: 540 });
  assert.equal(computePosition(a, { width: 200, height: 100 }, vp, { align: 'start' }).left, 500);
  assert.equal(computePosition(a, { width: 200, height: 100 }, vp, { align: 'end' }).left, 340);
  assert.equal(computePosition(a, { width: 200, height: 100 }, vp, { align: 'start', rtl: true }).left, 340);
});

test('popover taller than the viewport still starts on-screen', () => {
  const p = computePosition(rect({ top: 300, bottom: 330, left: 100, right: 140 }), { width: 100, height: 5000 }, vp);
  assert.equal(p.top, 8);
});
