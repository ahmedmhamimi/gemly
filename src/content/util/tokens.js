import { CONFIG } from '../core/config.js';

/**
 * Script-aware token estimate. A single chars-per-token ratio is fine for
 * English but badly under-counts Arabic, CJK, Indic scripts and emoji, so each
 * code point is weighted by its script. Still an estimate - the host page
 * never reports real usage.
 */
const SCRIPTS = [
  ['cjk', /[\u2e80-\u303f\u3040-\u30ff\u3100-\u312f\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/u],
  ['arabicHebrew', /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/u],
  ['indic', /[\u0900-\u0dff]/u],
  ['thaiKhmer', /[\u0e00-\u0eff\u1780-\u17ff]/u],
  ['cyrillicGreek', /[\u0370-\u03ff\u0400-\u052f]/u],
  ['emoji', /[\u{1f000}-\u{1faff}\u2600-\u27bf]/u],
];

export function estimateTokens(text) {
  if (!text) return 0;
  const weights = CONFIG.tokens;
  const counts = Object.create(null);
  let sawNonSpace = false;

  for (const ch of text) {
    if (ch <= ' ') continue; // whitespace/control carries ~no tokens on its own
    sawNonSpace = true;
    let bucket = 'latin';
    if (ch.charCodeAt(0) > 0x24f) {
      bucket = 'other';
      for (const [name, re] of SCRIPTS) {
        if (re.test(ch)) {
          bucket = name;
          break;
        }
      }
    }
    counts[bucket] = (counts[bucket] || 0) + 1;
  }
  if (!sawNonSpace) return 0;

  let tokens = 0;
  for (const bucket in counts) tokens += counts[bucket] / weights[bucket];
  // Whitespace-separated words each cost at least a token boundary.
  return Math.max(1, Math.round(tokens));
}

export function estimateCodeTokens(charCount) {
  return charCount > 0 ? Math.max(1, Math.round(charCount / CONFIG.tokens.code)) : 0;
}
