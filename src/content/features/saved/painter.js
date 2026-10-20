/**
 * Paints saved highlights with the CSS Custom Highlight API: nothing in Gemini's DOM
 * is touched (no wrapper elements), so Gemini's own rendering and our other features
 * are unaffected, and removing the feature leaves no trace.
 *
 * A highlight is stored as text; each paint re-locates it in the message's CURRENT
 * text nodes (locate.js). Repaints are skipped unless something relevant changed.
 */
import { GeminiHost as host } from '../../host/gemini.js';
import { keyOf } from '../bookmarks/index.js';
import { locateQuote } from './locate.js';
import { highlightsOf } from './model.js';

const NAME = 'gemly-saved';
let lastSig = '';

export const supported = () => typeof CSS !== 'undefined' && !!CSS.highlights && typeof Highlight === 'function';

/** Text nodes of a message, in order, skipping our own UI (bookmark button, badges…). */
export function textNodesOf(turn) {
  const root = host.assistantRoot(turn) || turn;
  const out = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('.gl-ui') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n);
  return out;
}

export function clearPaint() {
  lastSig = '';
  if (supported()) CSS.highlights.delete(NAME);
}

/** Force the next paint() to run (after the highlights changed). */
export const invalidate = () => {
  lastSig = '';
};

/**
 * @param {{ turns: Element[], index: any, generating: boolean }} scan
 * @param {string|null} convId
 */
export function paint({ turns, index, generating }, convId) {
  if (!supported()) return;
  const items = highlightsOf(convId);
  if (!items.length || !turns.length) return clearPaint();
  if (generating) return; // never repaint under a streaming reply
  const last = index.entry(turns[turns.length - 1]);
  const sig = `${convId}|${items.map((h) => `${h.id}${h.quote.length}`).join(',')}|${turns.length}|${last.length}`;
  if (sig === lastSig) return;
  lastSig = sig;

  const turnByKey = new Map();
  turns.forEach((t, i) => turnByKey.set(keyOf(index, turns, i), t));
  const nodeCache = new Map();
  const ranges = [];
  for (const h of items) {
    const turn = turnByKey.get(h.key);
    if (!turn) continue; // that message is not loaded right now
    let nodes = nodeCache.get(turn);
    if (!nodes) nodeCache.set(turn, (nodes = textNodesOf(turn)));
    const loc = locateQuote(nodes.map((n) => n.data), h.quote, h.occ);
    if (!loc) continue;
    try {
      const r = new Range();
      r.setStart(nodes[loc.start.chunk], loc.start.offset);
      r.setEnd(nodes[loc.end.chunk], loc.end.offset);
      ranges.push(r);
    } catch {
      /* the node changed under us: skip, the next scan repaints */
    }
  }
  if (ranges.length) CSS.highlights.set(NAME, new Highlight(...ranges));
  else CSS.highlights.delete(NAME);
}

/** Scroll to the message with this key and flash it. @returns {boolean} found */
export function scrollToKey(scan, key) {
  const i = scan.turns.findIndex((_, idx) => keyOf(scan.index, scan.turns, idx) === key);
  const target = i >= 0 ? scan.turns[i] : null;
  if (!target) return false;
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  target.classList.add('gl-flash-target');
  setTimeout(() => target.classList.remove('gl-flash-target'), 1900);
  return true;
}
