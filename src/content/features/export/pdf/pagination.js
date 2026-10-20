/**
 * Pure pagination maths for the PDF (unit-tested).
 *
 * Given a block's height and where the cursor is on the current page, decide
 * where the block (or slices of it, when taller than a page) are drawn and
 * when to start a new page.
 */

/**
 * @param {number} blockHeightPt
 * @param {number} cursorY       current y on the page (pt)
 * @param {{ marginPt: number, contentHeightPt: number, spacingPt: number }} page
 * @returns {{ placements: {addPage:boolean, y:number, srcPt:number, hPt:number}[], cursorY:number }}
 */
export function planPlacements(blockHeightPt, cursorY, { marginPt, contentHeightPt, spacingPt }) {
  const EPS = 0.01;
  const bottom = marginPt + contentHeightPt;
  const placements = [];

  if (blockHeightPt <= contentHeightPt) {
    const addPage = cursorY + blockHeightPt > bottom + EPS;
    const y = addPage ? marginPt : cursorY;
    placements.push({ addPage, y, srcPt: 0, hPt: blockHeightPt });
    return { placements, cursorY: y + blockHeightPt + spacingPt };
  }

  // Taller than one page: slice it, each slice on its own page.
  let offset = 0;
  let first = true;
  let y = cursorY;
  while (offset < blockHeightPt - EPS) {
    const hPt = Math.min(contentHeightPt, blockHeightPt - offset);
    const addPage = !first || y + hPt > bottom + EPS;
    if (addPage) y = marginPt;
    placements.push({ addPage, y, srcPt: offset, hPt });
    y += hPt + spacingPt;
    offset += hPt;
    first = false;
  }
  return { placements, cursorY: y };
}

/**
 * Group consecutive block heights into chunks that each stay under `maxCssPx`
 * (a single oversize block still gets its own chunk).
 * @param {number[]} heights css px
 * @returns {number[][]} arrays of block indices
 */
export function groupIntoChunks(heights, maxCssPx) {
  const chunks = [];
  let current = [];
  let sum = 0;
  heights.forEach((h, i) => {
    if (current.length && sum + h > maxCssPx) {
      chunks.push(current);
      current = [];
      sum = 0;
    }
    current.push(i);
    sum += h;
  });
  if (current.length) chunks.push(current);
  return chunks;
}
