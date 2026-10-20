import test from 'node:test';
import assert from 'node:assert/strict';
import { ZipWriter, concatParts, crc32, safeEntryName, utf8, zipParts } from '../../src/content/util/zip.js';

/** Independent minimal reader: walks the central directory and checks each CRC. */
function read(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  assert.equal(dv.getUint32(eocd, true), 0x06054b50, 'EOCD signature');
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = {};
  for (let i = 0; i < n; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50);
    const crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nl));
    assert.equal(dv.getUint32(off, true), 0x04034b50, 'local header');
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    const data = bytes.subarray(start, start + size);
    assert.equal(crc32(data), crc, `crc ${name}`);
    out[name] = new TextDecoder().decode(data);
    p += 46 + nl;
  }
  return out;
}

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(utf8('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
  assert.equal(crc32(utf8('6789'), crc32(utf8('12345'))), 0xcbf43926, 'incremental == one shot');
});

test('round trip: names, UTF-8 content, empty file', () => {
  const zip = concatParts(zipParts([{ name: 'a.md', data: '# héllo ✓' }, { name: 'dir/ب.txt', data: 'مرحبا' }, { name: 'empty', data: '' }]));
  assert.deepEqual(read(zip), { 'a.md': '# héllo ✓', 'dir/ب.txt': 'مرحبا', empty: '' });
});

test('duplicate names (case-insensitive) are de-duplicated, extension kept', () => {
  const z = new ZipWriter();
  assert.deepEqual([z.add('x.md', '1'), z.add('X.md', '2'), z.add('x.md', '3'), z.add('noext', 'a'), z.add('noext', 'b')], ['x.md', 'X (2).md', 'x (3).md', 'noext', 'noext (2)']);
  assert.equal(Object.keys(read(concatParts(z.finish()))).length, 5);
});

test('safeEntryName blocks traversal and control characters', () => {
  assert.equal(safeEntryName('../../etc/passwd'), 'etc/passwd');
  assert.equal(safeEntryName('/abs\\win\\x.txt'), 'abs/win/x.txt');
  assert.equal(safeEntryName('a\u0000b'), 'ab');
  assert.equal(safeEntryName('..'), 'file');
});

test('binary payloads survive and the entry limit is enforced', () => {
  const bin = Uint8Array.from({ length: 1000 }, (_, i) => i % 256);
  const z = new ZipWriter();
  z.add('b.bin', bin);
  const parts = z.finish();
  assert.equal(parts.reduce((n, p) => n + p.length, 0), 30 + 5 + 1000 + 46 + 5 + 22);
  const full = new ZipWriter();
  full._central.length = 0xffff; // simulate a full archive without allocating it
  full._central.fill(0);
  assert.throws(() => full.add('x', ''), /entry limit/);
});
