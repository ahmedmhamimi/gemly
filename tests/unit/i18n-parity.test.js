// jsdom-free twin of the parity checks in i18n.test.js (so they run anywhere).
import test from 'node:test';
import assert from 'node:assert/strict';
import en from '../../src/content/i18n/en.js';
import ar from '../../src/content/i18n/ar.js';
import ru from '../../src/content/i18n/ru.js';
import zh from '../../src/content/i18n/zh-CN.js';

const others = { ar, ru, 'zh-CN': zh };
const plural = (k) => k.startsWith('pdf.messages.');

test('every locale has exactly the English keys', () => {
  for (const [name, d] of Object.entries(others)) {
    assert.deepEqual(Object.keys(en).filter((k) => !(k in d) && !plural(k)), [], `${name} missing`);
    assert.deepEqual(Object.keys(d).filter((k) => !(k in en) && !plural(k)), [], `${name} stray`);
  }
});

test('placeholders match across locales and no value is empty', () => {
  const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
  for (const [name, d] of Object.entries(others)) {
    for (const k of Object.keys(en)) {
      if (plural(k) || !(k in d)) continue;
      assert.equal(ph(d[k]), ph(en[k]), `${name}:${k}`);
      assert.ok(d[k].trim(), `${name}:${k} empty`);
    }
  }
});

test('no hard-coded brand "Gemini" in new UI strings (compatibility wording only)', () => {
  // Existing strings may mention the host; new feature strings must not use it as branding.
  const offenders = Object.entries(en).filter(([k, v]) => /^(settings|feature|modal)\./.test(k) && /gemini/i.test(v));
  assert.deepEqual(offenders, []);
});
