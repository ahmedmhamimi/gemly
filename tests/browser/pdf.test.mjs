import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fixture, launch, openGemini } from './helpers.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function session(opts) {
  const ctx = await openGemini(browser, opts);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemly-dl-'));
  const cdp = await ctx.page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
  const waitFile = async (ext, timeoutMs = 170000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const f = fs.readdirSync(dir).find((n) => n.endsWith(ext) && !n.endsWith('.crdownload'));
      if (f) { await sleep(300); return path.join(dir, f); }
      await sleep(250);
    }
    throw new Error('download timeout; errors: ' + JSON.stringify(ctx.errors));
  };
  return { ...ctx, dir, waitFile };
}
const pdfStats = (file) => {
  const buf = fs.readFileSync(file);
  const txt = buf.toString('latin1');
  return { head: txt.slice(0, 5), pages: (txt.match(/\/Type\s*\/Page(?![s\w])/g) || []).length, images: (txt.match(/\/Subtype\s*\/Image/g) || []).length, bytes: buf.length };
};
const chooseFormat = async (page, btnSel, label) => {
  await page.evaluate((s) => document.querySelector(s).click(), btnSel);
  await sleep(200);
  await page.evaluate((l) => [...document.querySelectorAll('.gl-download-menu .gl-menu-item')].find((i) => i.textContent.includes(l)).click(), label);
};

const longChat = (turns) => {
  const code = Array.from({ length: 220 }, (_, i) => `line_${i} = compute(${i})  # ${'x'.repeat(30)}`).join('\n');
  const rows = Array.from({ length: 90 }, (_, i) => `<tr><td>row ${i}</td><td>${'value '.repeat(6)}</td></tr>`).join('');
  const one = (n) => `<div class="conversation-container"><user-query><div class="query-text"><p class="query-text-line">Question ${n}: ${'tell me more '.repeat(10)}</p></div></user-query>
    <model-response><message-content><div class="markdown">
      <h2>Answer ${n}</h2>${Array.from({ length: 8 }, (_, k) => `<p>Paragraph ${k} of answer ${n}. ${'Lorem ipsum dolor sit amet. '.repeat(12)}</p>`).join('')}
      <ul>${Array.from({ length: 6 }, (_, k) => `<li>Item ${k} ${'word '.repeat(8)}</li>`).join('')}</ul>
      <code-block><div class="code-block-decoration"><span>python</span></div><pre><code>${code}</code></pre></code-block>
      <table-block><table><tr><th>Name</th><th>Value</th></tr>${rows}</table></table-block>
    </div></message-content>
    <message-actions><div class="buttons"><copy-button><button aria-label="Copy">c</button></copy-button></div></message-actions></model-response></div>`;
  return fixture().replace(/<div class="conversation-container">\s*<user-query>[\s\S]*<\/model-response>\s*<\/div>\s*<\/div><\/infinite-scroller>/, Array.from({ length: turns }, (_, i) => one(i + 1)).join('') + '</div></infinite-scroller>');
};

test('PDF: short chat -> valid PDF, real image content, no errors', async () => {
  const { page, errors, waitFile } = await session({});
  await chooseFormat(page, '#gemly-export-btn', 'PDF');
  const file = await waitFile('.pdf', 60000);
  const s = pdfStats(file);
  assert.equal(s.head, '%PDF-');
  assert.ok(s.pages >= 1 && s.pages <= 3, JSON.stringify(s));
  assert.ok(s.images >= 3, 'rendered content blocks became images: ' + JSON.stringify(s));
  assert.ok(s.bytes > 8000, 'not a blank document: ' + s.bytes);
  assert.ok(path.basename(file).startsWith('Trip-plan'), path.basename(file));
  assert.deepEqual(errors.filter((e) => !/Failed to load resource/.test(e)), []);
  assert.equal(await page.evaluate(() => !!document.getElementById('gemly-pdf-render-stage')), false, 'render stage cleaned up');
  await page.close();
});

test('PDF: a VERY long chat (many pages, giant code block + 90-row tables) completes in bounded chunks', async () => {
  const { page, errors, waitFile } = await session({ html: longChat(14) });
  await sleep(1200);
  const height = await page.evaluate(() => document.getElementById('turns').scrollHeight);
  assert.ok(height > 30000, 'fixture is genuinely taller than any single canvas allows: ' + height);
  const t0 = Date.now();
  await chooseFormat(page, '#gemly-export-btn', 'PDF');
  // progress pill is shown while working
  await sleep(1500);
  assert.match(await page.evaluate(() => document.querySelector('.gl-loading')?.textContent || ''), /PDF/);
  const file = await waitFile('.pdf');
  const s = pdfStats(file);
  console.log(`      long chat: ${height}px tall -> ${s.pages} pages, ${s.images} images, ${(s.bytes / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  assert.ok(s.pages >= 20, `expected many pages, got ${s.pages}`);
  assert.ok(s.bytes > 300000, 'not blank: ' + s.bytes);
  assert.ok(s.images >= 50, 'many distinct images (identical slices are de-duplicated by jsPDF): ' + s.images);
  assert.deepEqual(errors.filter((e) => !/Failed to load resource/.test(e)), []);
  assert.equal(await page.evaluate(() => !!document.getElementById('gemly-pdf-render-stage')), false);
  await page.close();
});

test('PDF: second request while one runs is refused politely (no double render)', async () => {
  const { page, waitFile } = await session({ html: longChat(3) });
  await sleep(800);
  await chooseFormat(page, '#gemly-export-btn', 'PDF');
  await sleep(300);
  await page.evaluate(() => document.getElementById('gemly-export-btn').click());
  await sleep(150);
  await page.evaluate(() => [...document.querySelectorAll('.gl-download-menu .gl-menu-item')].find((i) => i.textContent.includes('PDF'))?.click());
  await sleep(300);
  assert.match(await page.evaluate(() => document.querySelector('.gl-toast')?.textContent || ''), /in progress|already|wait|قيد|выполн|进行/i);
  await waitFile('.pdf');
  await page.close();
});

test('PDF: per-reply export works from the reply action row', async () => {
  const { page, waitFile } = await session({});
  await chooseFormat(page, '.gl-msg-actions [data-gl-action="download"]', 'PDF');
  const file = await waitFile('.pdf', 60000);
  const s = pdfStats(file);
  assert.ok(s.pages >= 1 && s.images >= 2, JSON.stringify(s));
  assert.match(path.basename(file), /response\.pdf$/);
  await page.close();
});

test('PDF: Arabic (RTL) conversation exports', async () => {
  const html = fixture().replace('Plan a trip to Cairo', 'خطط لرحلة إلى القاهرة لمدة ثلاثة أيام').replace('<html lang="en">', '<html lang="ar" dir="rtl">');
  const { page, errors, waitFile } = await session({ html });
  await chooseFormat(page, '#gemly-export-btn', 'PDF').catch(async () => chooseFormat(page, '#gemly-export-btn', 'PDF'));
  const file = await waitFile('.pdf', 60000);
  assert.ok(pdfStats(file).bytes > 8000);
  assert.deepEqual(errors.filter((e) => !/Failed to load resource/.test(e)), []);
  await page.close();
});

test('JSON export is valid JSON without a BOM; TXT has a BOM; names are sanitised', async () => {
  const html = fixture().replace('<title>Trip plan - Google Gemini</title>', '<title>a/b:c*"CON" - Google Gemini</title>').replace('<div class="conversation-title">Trip plan</div>', '<div class="conversation-title">a/b:c*?</div>');
  const { page, waitFile } = await session({ html });
  await chooseFormat(page, '#gemly-export-btn', 'JSON');
  const jf = await waitFile('.json', 20000);
  const raw = fs.readFileSync(jf);
  assert.notEqual(raw[0], 0xef, 'no BOM in JSON');
  const j = JSON.parse(raw.toString('utf8'));
  assert.equal(j.source, 'Gemini');
  assert.equal(j.messages.length, 2);
  assert.match(j.messages[1].content, /Here is a plan with code and a link \(https:\/\/example\.com\)\./);
  assert.ok(!/[\\/:*?"<>|]/.test(path.basename(jf)), path.basename(jf));
  await chooseFormat(page, '#gemly-export-btn', 'Plain');
  const tf = await waitFile('.txt', 20000);
  const tr = fs.readFileSync(tf);
  assert.deepEqual([...tr.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM for Windows UTF-8');
  const text = tr.toString('utf8');
  assert.match(text, /You:\nPlan a trip to Cairo\nfor 3 days/);
  assert.match(text, /مرحبا بالعالم/);
  await page.close();
});

test('exporting an empty chat tells the person instead of producing an empty file', async () => {
  const { page } = await session({ html: fixture().replace(/<div class="conversation-container">[\s\S]*<\/model-response>\s*<\/div>/, '') });
  await page.evaluate(() => { history.pushState({}, '', '/app'); });
  await sleep(500);
  await chooseFormat(page, '#gemly-export-btn', 'JSON');
  await sleep(300);
  assert.match(await page.evaluate(() => document.querySelector('.gl-toast')?.textContent || ''), /No conversation|nothing|ابدأ/i);
  await page.close();
});
