import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './env.js';

const dom = setupDom();
const { Lang } = await import('../../src/content/i18n/index.js');
const en = (await import('../../src/content/i18n/en.js')).default;
const ar = (await import('../../src/content/i18n/ar.js')).default;
const ru = (await import('../../src/content/i18n/ru.js')).default;
const zh = (await import('../../src/content/i18n/zh-CN.js')).default;
const setLang = (l) => { dom.window.document.documentElement.setAttribute('lang', l); Lang._reset(); };

test('every locale has exactly the English keys (no gaps, no strays)', () => {
  for (const [name, d] of Object.entries({ ar, ru, 'zh-CN': zh })) {
    const missing = Object.keys(en).filter((k) => !(k in d) && !k.startsWith('pdf.messages.'));
    const stray = Object.keys(d).filter((k) => !(k in en) && !k.startsWith('pdf.messages.'));
    assert.deepEqual(missing, [], `${name} missing`);
    assert.deepEqual(stray, [], `${name} stray`);
  }
});

test('placeholders match across locales', () => {
  const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
  for (const [name, d] of Object.entries({ ar, ru, 'zh-CN': zh })) {
    for (const k of Object.keys(en)) if (k in d && !k.startsWith('pdf.messages.')) assert.equal(ph(d[k]), ph(en[k]), `${name}:${k}`);
  }
});

test('language detection: html lang wins; zh/ru/ar/en; unknown -> en; regional codes', () => {
  for (const [html, want] of [['en-GB', 'en'], ['ar-EG', 'ar'], ['ru', 'ru'], ['zh-TW', 'zh-CN'], ['fr', 'en'], ['', 'en']]) {
    setLang(html);
    assert.equal(Lang.locale(), want, html);
  }
  setLang('ar');
  assert.equal(Lang.isRtl(), true);
});

test('t(): fallback to English then key; replacement is literal (no $ patterns)', () => {
  setLang('en');
  assert.equal(Lang.t('definitely.missing'), 'definitely.missing');
  assert.equal(Lang.t('folders.deleted', { name: "$& $1 $$ x" }), 'Deleted \u201c$& $1 $$ x\u201d');
  assert.equal(Lang.t('folders.deleted', {}), 'Deleted \u201c{name}\u201d'); // unknown placeholder left visible, not "undefined"
});

test('plural(): English one/other, Russian few/many, Arabic zero/two/few/many', () => {
  setLang('en');
  assert.equal(Lang.plural('pdf.messages', 1), '1 message');
  assert.equal(Lang.plural('pdf.messages', 3), '3 messages');
  setLang('ru');
  assert.equal(Lang.plural('pdf.messages', 1), '1 сообщение');
  assert.equal(Lang.plural('pdf.messages', 3), '3 сообщения');
  assert.equal(Lang.plural('pdf.messages', 5), '5 сообщений');
  setLang('ar');
  assert.equal(Lang.plural('pdf.messages', 0), 'لا رسائل');
  assert.equal(Lang.plural('pdf.messages', 2), 'رسالتان');
  assert.equal(Lang.plural('pdf.messages', 5), '5 رسائل');
  setLang('zh');
  assert.equal(Lang.plural('pdf.messages', 7), '7 条消息');
});

test('sync() reports a runtime language change', () => {
  setLang('en');
  Lang.locale();
  dom.window.document.documentElement.setAttribute('lang', 'ru');
  assert.equal(Lang.sync(), true);
  assert.equal(Lang.locale(), 'ru');
  assert.equal(Lang.sync(), false);
});
