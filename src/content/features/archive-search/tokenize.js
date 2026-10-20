/**
 * Tokenizer shared by the index (service worker) and the snippet highlighter
 * (page). Pure.
 *
 *  - words are runs of letters/digits in any script; case-folded
 *  - accents are dropped (é -> e, ё -> е) and Arabic diacritics / alef variants
 *    are normalised, so "cafe" finds "café" and "الاسلام" finds "الإسلام"
 *  - scripts written without spaces (Han, Hiragana, Katakana, Thai) produce
 *    overlapping BIGRAMS (single characters when the run is one long), so
 *    "机器学习" is findable by "学习"
 *  - every token carries its [start, end) offsets in the ORIGINAL text, which is
 *    how highlights stay correct even though tokens are normalised
 */
import { foldCase } from '../../util/text.js';

const WORD = /[\p{L}\p{N}]+/gu;
const UNSPACED = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Thai}';
const SEGMENT = new RegExp(`[${UNSPACED}]+|[^${UNSPACED}]+`, 'gu');
const IS_UNSPACED = new RegExp(`^[${UNSPACED}]`, 'u');
// Combining marks worth dropping: Latin/Cyrillic/Greek diacritics and Arabic harakat.
// (Not all of \p{M}: that would destroy Devanagari/Thai vowel signs.)
const STRIP = /[\u0300-\u036f\u064b-\u065f\u0670\u06d6-\u06ed]/g;
const ALEF = /[\u0622\u0623\u0625\u0671]/g;

export const LIMITS = Object.freeze({ maxTokenChars: 40, maxTokensPerDoc: 6000, maxQueryTokens: 8 });

/** Normalise one already-separated word. */
export function normalizeWord(word) {
  let w = foldCase(word);
  if (/[^\u0000-\u007f]/.test(w)) {
    w = w.normalize('NFD').replace(STRIP, '').normalize('NFC').replace(ALEF, '\u0627').replace(/\u0649/g, '\u064a');
  }
  return w;
}

const len = (s) => Array.from(s).length;

/**
 * @param {string} text
 * @returns {{ t: string, s: number, e: number }[]} tokens in text order (duplicates kept)
 */
export function tokenizeWithPositions(text, { max = Infinity } = {}) {
  const out = [];
  const src = String(text ?? '');
  WORD.lastIndex = 0;
  for (let m = WORD.exec(src); m && out.length < max; m = WORD.exec(src)) {
    const base = m.index;
    SEGMENT.lastIndex = 0;
    for (let seg = SEGMENT.exec(m[0]); seg; seg = SEGMENT.exec(m[0])) {
      const start = base + seg.index;
      if (IS_UNSPACED.test(seg[0])) {
        const chars = Array.from(seg[0]);
        if (chars.length === 1) out.push({ t: seg[0], s: start, e: start + seg[0].length });
        let off = 0;
        for (let i = 0; i + 1 < chars.length; i++) {
          const a = chars[i];
          out.push({ t: a + chars[i + 1], s: start + off, e: start + off + a.length + chars[i + 1].length });
          off += a.length;
        }
      } else {
        const t = normalizeWord(seg[0]);
        const n = len(t);
        if (n >= 2 && n <= LIMITS.maxTokenChars) out.push({ t, s: start, e: start + seg[0].length });
      }
    }
  }
  return out;
}

/** Unique tokens of a document (what the index stores). */
export function tokenize(text, { max = LIMITS.maxTokensPerDoc } = {}) {
  const set = new Set();
  for (const { t } of tokenizeWithPositions(text)) {
    set.add(t);
    if (set.size >= max) break;
  }
  return [...set];
}

/** Query -> unique tokens in order. A one-character Latin query yields nothing. */
export function queryTokens(query) {
  const seen = new Set();
  for (const { t } of tokenizeWithPositions(query)) {
    seen.add(t);
    if (seen.size >= LIMITS.maxQueryTokens) break;
  }
  return [...seen];
}
