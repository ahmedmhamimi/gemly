/**
 * CSV (RFC 4180) for extracted tables (pure).
 *
 * Formula injection: a cell beginning with = + - @ (or tab / CR) is executed as a
 * formula by Excel and friends. Tables come from AI replies, i.e. untrusted text, so
 * such cells are prefixed with an apostrophe, EXCEPT plain numbers ("-5", "+3.2",
 * "12%") which must stay numeric.
 */

const PLAIN_NUMBER = /^[+-]?(\d+([.,]\d+)?|[.,]\d+)%?$/;

export function neutralizeFormula(cell) {
  const s = String(cell ?? '');
  if (!s) return s;
  if (/^[=@\t\r]/.test(s)) return `'${s}`;
  if (/^[+-]/.test(s) && !PLAIN_NUMBER.test(s.trim())) return `'${s}`;
  return s;
}

export function cellToCsv(value, { neutralize = true } = {}) {
  const s = neutralize ? neutralizeFormula(value) : String(value ?? '');
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * @param {string[][]} rows
 * @param {{ bom?: boolean, eol?: string, neutralize?: boolean }} [o]
 *   `bom`: a UTF-8 byte-order mark so Excel opens Arabic / Chinese text correctly.
 */
export function tableToCsv(rows, { bom = true, eol = '\r\n', neutralize = true } = {}) {
  const body = rows.map((r) => r.map((c) => cellToCsv(c, { neutralize })).join(',')).join(eol);
  return `${bom ? '\ufeff' : ''}${body}${rows.length ? eol : ''}`;
}
