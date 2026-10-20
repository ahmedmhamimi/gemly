import test from 'node:test';
import assert from 'node:assert/strict';
import { groupIntoChunks, planPlacements } from '../../src/content/features/export/pdf/pagination.js';

const page = { marginPt: 36, contentHeightPt: 770, spacingPt: 8 };

test('a block that fits stays on the current page', () => {
  const r = planPlacements(100, 36, page);
  assert.deepEqual(r.placements, [{ addPage: false, y: 36, srcPt: 0, hPt: 100 }]);
  assert.equal(r.cursorY, 144);
});

test('a block that does not fit moves to a new page', () => {
  const r = planPlacements(200, 700, page);
  assert.equal(r.placements[0].addPage, true);
  assert.equal(r.placements[0].y, 36);
});

test('a block exactly filling the page does not spill', () => {
  const r = planPlacements(770, 36, page);
  assert.equal(r.placements.length, 1);
  assert.equal(r.placements[0].addPage, false);
});

test('a block taller than a page is sliced; slices tile with no gap or overlap', () => {
  const total = 2000;
  const r = planPlacements(total, 300, page);
  assert.ok(r.placements.length >= 3);
  assert.equal(r.placements[0].addPage, true, 'cannot start mid-page');
  let covered = 0;
  for (const p of r.placements) {
    assert.ok(Math.abs(p.srcPt - covered) < 1e-6, 'contiguous source ranges');
    assert.ok(p.hPt <= page.contentHeightPt + 1e-6);
    assert.equal(p.y, 36);
    covered += p.hPt;
  }
  assert.ok(Math.abs(covered - total) < 1e-6, 'every pixel drawn exactly once');
});

test('a tall block on a fresh page does not add a leading blank page', () => {
  const r = planPlacements(1600, 36, page);
  assert.equal(r.placements[0].addPage, false);
});

test('zero-height blocks are harmless', () => {
  const r = planPlacements(0, 36, page);
  assert.equal(r.placements.length, 1);
});

test('groupIntoChunks bounds every chunk (oversize block gets its own)', () => {
  const heights = [100, 200, 5000, 300, 300, 4900, 50];
  const chunks = groupIntoChunks(heights, 5200);
  assert.deepEqual(chunks.flat(), [0, 1, 2, 3, 4, 5, 6], 'order preserved, nothing lost');
  for (const c of chunks) {
    const sum = c.reduce((a, i) => a + heights[i], 0);
    assert.ok(sum <= 5200 || c.length === 1, `chunk ${c} sum ${sum}`);
  }
  assert.deepEqual(groupIntoChunks([], 100), []);
  assert.deepEqual(groupIntoChunks([9999], 100), [[0]]);
});
