/**
 * Text-node map of an element, for searching across inline markup.
 *
 * Concatenates the text nodes under `root` into one string, inserting a
 * separator (U+0000) wherever the block-level ancestor changes so a search
 * term can never match across two paragraphs/list items. `findRanges` then
 * maps matches in that string back to DOM Ranges.
 */
import { foldCase } from '../../util/text.js';

const BLOCK = 'p, li, div, td, th, tr, h1, h2, h3, h4, h5, h6, pre, blockquote, code-block, table';
const SKIP = 'button, style, script, .cdk-visually-hidden, mat-icon, source-footnote';

export function isNoiseNodeForSearch(node) {
  return !!node.parentElement?.closest(SKIP);
}

/** @returns {{ text: string, folded: string, nodes: {node: Text, start: number}[] }} */
export function buildTextMap(root) {
  const nodes = [];
  let text = '';
  let prevBlock = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (isNoiseNodeForSearch(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const block = n.parentElement?.closest(BLOCK) || null;
    if (prevBlock !== null && block !== prevBlock) text += '\u0000';
    prevBlock = block;
    nodes.push({ node: n, start: text.length });
    text += n.textContent;
  }
  return { text, folded: foldCase(text), nodes };
}

/** Index of the node containing offset `pos` (binary search). */
function nodeAt(nodes, pos) {
  let lo = 0;
  let hi = nodes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (nodes[mid].start <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** All Ranges in `map` matching the (already folded) `term`. */
export function findRanges(map, term) {
  const out = [];
  if (!term || !map.nodes.length) return out;
  let from = 0;
  for (let at = map.folded.indexOf(term, from); at !== -1; at = map.folded.indexOf(term, from)) {
    const end = at + term.length;
    const a = nodeAt(map.nodes, at);
    const b = nodeAt(map.nodes, end - 1);
    const range = document.createRange();
    range.setStart(map.nodes[a].node, at - map.nodes[a].start);
    range.setEnd(map.nodes[b].node, end - map.nodes[b].start);
    out.push(range);
    from = end;
  }
  return out;
}
