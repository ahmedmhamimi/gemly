/** Pure helpers for showing highlighted text without innerHTML. */

/**
 * Split `text` by non-overlapping, sorted `ranges` into alternating segments.
 * @returns {{ text: string, hit: boolean }[]} (empty segments are never produced)
 */
export function splitByRanges(text, ranges) {
  const out = [];
  let at = 0;
  for (const [s, e] of ranges) {
    if (s < at || e > text.length || e <= s) continue; // defensive: ignore malformed/overlapping ranges
    if (s > at) out.push({ text: text.slice(at, s), hit: false });
    out.push({ text: text.slice(s, e), hit: true });
    at = e;
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out;
}

/** Day bounds in local time for `<input type="date">` values ("YYYY-MM-DD"); null when empty/invalid. */
export function dayStart(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3], 0, 0, 0, 0).getTime() : null;
}
export function dayEnd(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999).getTime() : null;
}
