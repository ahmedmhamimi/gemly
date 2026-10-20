import test from 'node:test';
import assert from 'node:assert/strict';
import { codeFileNames, guessFile, normalizeLang } from '../../src/content/features/extract/filetypes.js';
import { cellToCsv, neutralizeFormula, tableToCsv } from '../../src/content/features/extract/csv.js';
import { buildXlsx, colName, sheetNames } from '../../src/content/features/extract/xlsx.js';
import { concatParts } from '../../src/content/util/zip.js';

test('normalizeLang and extension guessing from the label', () => {
  assert.equal(normalizeLang(' Python '), 'python');
  assert.equal(normalizeLang('language-js'), 'js');
  assert.equal(normalizeLang('C++'), 'c++');
  for (const [lang, ext] of [['Python', 'py'], ['JavaScript', 'js'], ['TypeScript', 'ts'], ['bash', 'sh'], ['C#', 'cs'], ['C++', 'cpp'], ['yml', 'yaml'], ['Rust', 'rs'], ['SQL', 'sql'], ['html', 'html'], ['jsx', 'jsx'], ['Kotlin', 'kt']]) {
    assert.equal(guessFile(lang, 'x').ext, ext, lang);
  }
});

test('files known by name keep it; unknown labels fall back to sniffing, then txt', () => {
  assert.equal(guessFile('Dockerfile', 'FROM node').fixedName, 'Dockerfile');
  assert.equal(guessFile('makefile', 'all:').fixedName, 'Makefile');
  assert.equal(guessFile('', '#!/bin/bash\necho hi').ext, 'sh');
  assert.equal(guessFile('', '#!/usr/bin/env python3\nprint(1)').ext, 'py');
  assert.equal(guessFile('', '<!DOCTYPE html><p>x</p>').ext, 'html');
  assert.equal(guessFile('', '<?php echo 1;').ext, 'php');
  assert.equal(guessFile('', '{"a": [1, 2]}').ext, 'json');
  assert.equal(guessFile('', '{not json').ext, 'txt');
  assert.equal(guessFile('weirdlang', 'hello').ext, 'txt');
  assert.equal(guessFile(undefined, undefined).ext, 'txt');
});

test('codeFileNames: stable numbering, safe base, special files keep their names', () => {
  assert.deepEqual(codeFileNames([{ lang: 'python', code: '' }, { lang: 'Dockerfile', code: '' }, { lang: '', code: '{"a":1}' }], 'My chat: plan/1'), ['My-chat-plan1-1.py', 'Dockerfile', 'My-chat-plan1-3.json']);
  assert.deepEqual(codeFileNames([{ lang: 'js', code: '' }], '../../etc'), ['etc-1.js']);
  assert.deepEqual(codeFileNames([{ lang: 'js', code: '' }], ''), ['code-1.js']);
});

test('CSV: quoting rules, doubled quotes, newlines, BOM, eol', () => {
  assert.equal(cellToCsv('plain'), 'plain');
  assert.equal(cellToCsv('a,b'), '"a,b"');
  assert.equal(cellToCsv('say "hi"'), '"say ""hi"""');
  assert.equal(cellToCsv('two\nlines'), '"two\nlines"');
  assert.equal(cellToCsv(' padded '), '" padded "');
  assert.equal(tableToCsv([['a', 'b'], ['1', '2']]), '\ufeffa,b\r\n1,2\r\n');
  assert.equal(tableToCsv([['a']], { bom: false, eol: '\n' }), 'a\n');
  assert.equal(tableToCsv([], { bom: false }), '');
});

test('CSV formula injection is neutralised, numbers are not touched', () => {
  for (const evil of ['=1+1', '@SUM(A1)', '+cmd|calc', '-2+3', '\tx', '=HYPERLINK("http://x")']) assert.equal(neutralizeFormula(evil)[0], "'", evil);
  for (const ok of ['-5', '+3.2', '12%', '-0,5', '5', 'hello', 'a=b', '']) assert.equal(neutralizeFormula(ok), ok, ok);
  assert.equal(cellToCsv('=1+1'), "'=1+1");
  assert.equal(cellToCsv('=1+1', { neutralize: false }), '=1+1');
});

test('xlsx helpers: column names and valid unique sheet names', () => {
  assert.deepEqual([0, 25, 26, 27, 701, 702].map(colName), ['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  assert.deepEqual(sheetNames(3), ['Table 1', 'Table 2', 'Table 3']);
  assert.equal(sheetNames(1, 'x'.repeat(50))[0].length <= 31, true);
});

/** Pull the entries out of our own stored zip (central directory walk). */
function entries(parts) {
  const b = concatParts(parts); const dv = new DataView(b.buffer);
  const n = dv.getUint16(b.length - 12, true); let p = dv.getUint32(b.length - 6, true); const out = {};
  for (let i = 0; i < n; i++) { const nl = dv.getUint16(p + 28, true), sz = dv.getUint32(p + 24, true), off = dv.getUint32(p + 42, true);
    out[new TextDecoder().decode(b.subarray(p + 46, p + 46 + nl))] = new TextDecoder().decode(b.subarray(off + 30 + nl, off + 30 + nl + sz)); p += 46 + nl; }
  return out;
}

test('xlsx: package structure, header style, numbers vs text, escaping, no formulas', () => {
  const files = entries(buildXlsx([[['Name', 'Qty', 'Note'], ['<A&B>', '12.5', '=1+1'], ['x', '007', 'say "hi"']], [['only']]], { now: new Date(2026, 0, 1) }));
  assert.deepEqual(Object.keys(files).sort(), ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']);
  const s1 = files['xl/worksheets/sheet1.xml'];
  assert.match(s1, /<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Name<\/t>/, 'bold header');
  assert.match(s1, /&lt;A&amp;B&gt;/);
  assert.match(s1, /<c r="B2"><v>12\.5<\/v><\/c>/, 'a plain number is numeric');
  assert.match(s1, /<c r="B3" t="inlineStr"><is><t xml:space="preserve">007<\/t>/, 'leading zeros stay text');
  assert.equal(s1.includes('<f>'), false, 'no formula elements');
  assert.match(s1, />=1\+1</, 'the formula-looking text is stored as plain text');
  assert.match(files['xl/workbook.xml'], /<sheet name="Table 1" sheetId="1" r:id="rId1"\/><sheet name="Table 2"/);
  assert.throws(() => buildXlsx([]), /no tables/);
});

test('xlsx: control characters are stripped, huge cells truncated, ragged rows fine', () => {
  const s = entries(buildXlsx([[['a\u0000b\u0008c', 'x'.repeat(40000)], ['only one']]]))['xl/worksheets/sheet1.xml'];
  assert.match(s, />abc</);
  assert.equal(s.match(/x{32767}/)?.[0].length, 32767);
  assert.equal(/x{32768}/.test(s), false);
});
