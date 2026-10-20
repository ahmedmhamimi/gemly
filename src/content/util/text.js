/** Pure text helpers. No DOM, no browser APIs - trivially unit-testable. */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Escape for safe interpolation into HTML text AND quoted attribute values.
 * (The previous textContent/innerHTML trick left quotes unescaped, which
 * broke attributes such as placeholder="...").
 */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

/** FNV-1a: short, stable, non-cryptographic key for text. */
export function hashText(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Truncate by code points (never splits a surrogate pair / emoji). */
export function truncate(text, max, ellipsis = '\u2026') {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join('').trimEnd() + ellipsis : text;
}

export function collapseWhitespace(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/**
 * Safe cross-platform filename stem (no extension).
 * Strips path separators, control + bidi-control characters, collapses
 * whitespace, avoids Windows reserved names and trailing dots/spaces, and
 * caps length by code points.
 */
export function sanitizeFilename(name, fallback = 'Gemini-Conversation') {
  let out = String(name ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/^[.-]+/, '')
    .replace(/[. -]+$/, '');
  out = Array.from(out).slice(0, 80).join('').replace(/[. -]+$/, '');
  if (!out || WINDOWS_RESERVED.test(out)) return fallback;
  return out;
}

/**
 * Lower-case without ever changing string length. `'İ'.toLowerCase()` is two
 * UTF-16 units, which would shift every later match offset; characters whose
 * lower-case form differs in length are kept as-is.
 */
export function foldCase(text) {
  let out = '';
  for (const ch of text) {
    const lower = ch.toLowerCase();
    out += lower.length === ch.length ? lower : ch;
  }
  return out;
}

export function pluralize(count, noun, plural = `${noun}s`) {
  return count === 1 ? `1 ${noun}` : `${count} ${plural}`;
}

export function debounce(fn, waitMs) {
  let handle = null;
  const debounced = function (...args) {
    clearTimeout(handle);
    handle = setTimeout(() => {
      handle = null;
      fn.apply(this, args);
    }, waitMs);
  };
  debounced.cancel = () => {
    clearTimeout(handle);
    handle = null;
  };
  return debounced;
}

let uidCounter = 0;
export function uid(prefix = 'g') {
  uidCounter = (uidCounter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${uidCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Strip control chars + collapse whitespace; for user-entered names. */
export function cleanLabel(value, maxLength) {
  // eslint-disable-next-line no-control-regex
  const s = String(value ?? '').replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e]/g, ' ');
  return Array.from(collapseWhitespace(s)).slice(0, maxLength).join('');
}
