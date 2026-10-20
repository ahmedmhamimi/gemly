/**
 * Highlighted snippets and relevance (pure).
 *
 * Matching uses the SAME tokenizer as the index, so a hit in the index is always
 * findable here, and offsets refer to the original text (accents, CJK, astral
 * characters included).
 */
import { tokenizeWithPositions } from './tokenize.js';

/** Does token `t` satisfy query token `q`? The last query token also matches as a prefix (type-ahead). */
export const matches = (t, q, prefix) => t === q || (prefix && t.startsWith(q));

/** @returns {[number, number][]} ranges in `text` that match any query token */
export function highlightRanges(text, qTokens) {
  const last = qTokens.length - 1;
  const out = [];
  for (const { t, s, e } of tokenizeWithPositions(text)) {
    if (qTokens.some((q, i) => matches(t, q, i === last))) out.push([s, e]);
  }
  return mergeRanges(out);
}

function mergeRanges(r) {
  const out = [];
  for (const [s, e] of r) {
    const prev = out[out.length - 1];
    if (prev && s <= prev[1]) prev[1] = Math.max(prev[1], e);
    else out.push([s, e]);
  }
  return out;
}

/**
 * @returns {{ text: string, ranges: [number, number][], cutStart: boolean, cutEnd: boolean }[]}
 *   up to `max` windows around matches, best first; ranges are relative to `text`
 */
export function buildSnippets(text, qTokens, { max = 2, radius = 70 } = {}) {
  const src = String(text ?? '');
  const hits = highlightRanges(src, qTokens);
  if (!hits.length) return [];
  const last = qTokens.length - 1;
  const hitTokens = tokenizeWithPositions(src)
    .map(({ t, s }) => ({ s, q: qTokens.findIndex((q, i) => matches(t, q, i === last)) }))
    .filter((h) => h.q >= 0);

  // Grow a window around each hit, then merge windows that touch.
  const wins = [];
  for (const [s, e] of hits) {
    let a = Math.max(0, s - radius);
    let b = Math.min(src.length, e + radius);
    // Snap to whitespace so words are not cut (only within a few characters).
    for (let k = 0; k < 12 && a > 0 && !/\s/.test(src[a - 1]); k++) a++;
    for (let k = 0; k < 12 && b < src.length && !/\s/.test(src[b]); k++) b--;
    if (a >= s) a = Math.max(0, s - radius);
    if (b <= e) b = Math.min(src.length, e + radius);
    const prev = wins[wins.length - 1];
    if (prev && a <= prev.b) prev.b = Math.max(prev.b, b);
    else wins.push({ a, b });
  }
  const scored = wins.map((w) => ({ ...w, score: new Set(hitTokens.filter((h) => h.s >= w.a && h.s < w.b).map((h) => h.q)).size }));
  scored.sort((x, y) => y.score - x.score || x.a - y.a);
  return scored
    .slice(0, max)
    .sort((x, y) => x.a - y.a)
    .map(({ a, b }) => ({
      text: src.slice(a, b).replace(/\s/g, ' '),
      ranges: hits.filter(([s, e]) => s >= a && e <= b).map(([s, e]) => [s - a, e - a]),
      cutStart: a > 0,
      cutEnd: b < src.length,
    }));
}

// eslint-disable-next-line no-control-regex
const NON_ASCII = /[^\u0000-\u007f]/;

/**
 * Cheap pre-check that lets matchCounts skip the tokenizer for most messages.
 * For pure-ASCII text a hit REQUIRES the (lower-case ASCII) token to occur as a
 * substring, so this has no false negatives; text with any other character is never
 * skipped (accent folding / CJK bigrams make substring tests unsafe there).
 */
function mayMatch(text, qTokens) {
  if (NON_ASCII.test(text)) return true;
  const low = text.toLowerCase();
  return qTokens.some((q) => low.includes(q));
}

/** Occurrences of each query token in `text` (prefix rule on the last), weighted. One tokenizer pass. */
export function matchCounts(text, qTokens, weight = 1, into = new Array(qTokens.length).fill(0)) {
  if (!mayMatch(text, qTokens)) return into;
  const last = qTokens.length - 1;
  for (const { t } of tokenizeWithPositions(text)) {
    for (let i = 0; i < qTokens.length; i++) if (matches(t, qTokens[i], i === last)) into[i] += weight;
  }
  return into;
}

/** Relevance from per-token counts: covering every token dominates, then log-damped frequency. */
export function scoreFromCounts(counts) {
  const covered = counts.filter((c) => c > 0).length;
  return covered * 100 + counts.reduce((s, c) => s + Math.log2(1 + c) * 10, 0);
}

/**
 * Relevance: term frequency with diminishing returns, a big bonus for covering
 * every query token, and a title bonus. Higher is better.
 */
export function scoreDocument(title, texts, qTokens) {
  const counts = matchCounts(title, qTokens, 8);
  for (const t of texts) matchCounts(t, qTokens, 1, counts);
  return scoreFromCounts(counts);
}
