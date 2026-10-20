/**
 * Minimal ZIP writer: "stored" entries only (no compression), UTF-8 names.
 *
 * Why it exists: multi-file downloads (a backup of many chats, all code blocks
 * of a reply, an XLSX workbook) need one container, and a 40 KB writer beats a
 * dependency. Stored entries are fine here because the content is text that
 * the person will usually keep as-is.
 *
 * Limits (checked, never silently wrong): no ZIP64, so at most 65 535 entries
 * and 4 GiB. Pure: no DOM, no chrome.*.
 */

const MAX_ENTRIES = 0xffff;
const MAX_BYTES = 0xffffffff;

let table = null;
function crcTable() {
  if (table) return table;
  table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

/** CRC-32 (IEEE) of a byte array; pass a previous result as `seed` to continue. */
export function crc32(bytes, seed = 0) {
  const t = crcTable();
  let c = ~seed >>> 0;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

const encoder = new TextEncoder();
export const utf8 = (s) => encoder.encode(String(s));

function dosDateTime(date) {
  const d = date instanceof Date && !Number.isNaN(+date) ? date : new Date(Date.UTC(2020, 0, 1));
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Make an entry name safe: forward slashes, no leading slash, no `..`, no control chars. */
export function safeEntryName(name) {
  const parts = String(name ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p && p !== '.' && p !== '..');
  return parts.join('/') || 'file';
}

export class ZipWriter {
  constructor({ now = new Date() } = {}) {
    this._parts = [];
    this._central = [];
    this._offset = 0;
    this._names = new Set();
    this._now = now;
  }

  get count() {
    return this._central.length;
  }

  /** Name actually used (de-duplicated: "a.md", "a (2).md", …). */
  add(name, data, { date = this._now } = {}) {
    if (this._central.length >= MAX_ENTRIES) throw new Error('ZIP entry limit reached');
    const bytes = typeof data === 'string' ? utf8(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
    if (bytes.length > MAX_BYTES || this._offset + bytes.length > MAX_BYTES) throw new Error('ZIP size limit reached');

    let final = safeEntryName(name);
    if (this._names.has(final.toLowerCase())) {
      const dot = final.lastIndexOf('.');
      const stem = dot > final.lastIndexOf('/') + 1 ? final.slice(0, dot) : final;
      const ext = stem === final ? '' : final.slice(dot);
      for (let i = 2; ; i++) {
        final = `${stem} (${i})${ext}`;
        if (!this._names.has(final.toLowerCase())) break;
      }
    }
    this._names.add(final.toLowerCase());

    const nameBytes = utf8(final);
    const crc = crc32(bytes);
    const { time, date: dd } = dosDateTime(date);

    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true); // version needed
    header.setUint16(6, 0x0800, true); // UTF-8 names
    header.setUint16(8, 0, true); // stored
    header.setUint16(10, time, true);
    header.setUint16(12, dd, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, bytes.length, true);
    header.setUint32(22, bytes.length, true);
    header.setUint16(26, nameBytes.length, true);
    header.setUint16(28, 0, true);

    this._central.push({ nameBytes, crc, size: bytes.length, offset: this._offset, time, date: dd });
    this._parts.push(new Uint8Array(header.buffer), nameBytes, bytes);
    this._offset += 30 + nameBytes.length + bytes.length;
    return final;
  }

  /** @returns {Uint8Array[]} parts to hand to `new Blob(parts)` (no big concatenation). */
  finish() {
    const centralStart = this._offset;
    const out = [...this._parts];
    let centralSize = 0;
    for (const e of this._central) {
      const h = new DataView(new ArrayBuffer(46));
      h.setUint32(0, 0x02014b50, true);
      h.setUint16(4, 20, true); // made by
      h.setUint16(6, 20, true); // needed
      h.setUint16(8, 0x0800, true);
      h.setUint16(10, 0, true);
      h.setUint16(12, e.time, true);
      h.setUint16(14, e.date, true);
      h.setUint32(16, e.crc, true);
      h.setUint32(20, e.size, true);
      h.setUint32(24, e.size, true);
      h.setUint16(28, e.nameBytes.length, true);
      h.setUint32(42, e.offset, true);
      out.push(new Uint8Array(h.buffer), e.nameBytes);
      centralSize += 46 + e.nameBytes.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this._central.length, true);
    end.setUint16(10, this._central.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, centralStart, true);
    out.push(new Uint8Array(end.buffer));
    return out;
  }
}

/** Convenience: entries -> Uint8Array[]. */
export function zipParts(entries, opts) {
  const z = new ZipWriter(opts);
  for (const e of entries) z.add(e.name, e.data, { date: e.date });
  return z.finish();
}

export function concatParts(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
