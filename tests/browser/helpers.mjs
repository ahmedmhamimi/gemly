import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const dist = (f) => path.join(root, 'dist', f);
export const fixture = (f = 'gemini.html') => fs.readFileSync(path.join(root, 'tests/fixtures', f), 'utf8');

export async function launch() {
  return puppeteer.launch({
    args: [...chromium.args, '--no-sandbox', '--window-size=1280,900'],
    executablePath: await chromium.executablePath(),
    headless: 'shell',
    defaultViewport: { width: 1280, height: 900 },
  });
}

/** In-page chrome.* stub backed by a Map the test can inspect. */
const CHROME_STUB = `
(() => {
  const store = (window.__store = window.__store || {});
  const listeners = [];
  window.__storageSets = 0;
  window.chrome = {
    runtime: {
      id: 'test-extension-id',
      getURL: (p) => 'chrome-extension://test/' + p,
      sendMessage: async (msg) => {
        if (msg.type === 'gemly:load-vendor') return await window.__loadVendor();
        if (msg.type === 'gemly:claim-welcome') return { claimed: !!window.__claimWelcome };
        return {};
      },
    },
    storage: {
      local: {
        get: async (keys) => { const o = {}; (Array.isArray(keys) ? keys : [keys]).forEach((k) => { if (k in store) o[k] = JSON.parse(JSON.stringify(store[k])); }); return o; },
        set: async (o) => { window.__storageSets++; if (window.__failStorage) throw new Error(window.__failStorage); const ch = {}; for (const [k, v] of Object.entries(o)) { ch[k] = { oldValue: store[k], newValue: JSON.parse(JSON.stringify(v)) }; store[k] = JSON.parse(JSON.stringify(v)); } listeners.forEach((l) => l(ch, 'local')); },
      },
      onChanged: { addListener: (l) => listeners.push(l), removeListener: (l) => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); } },
    },
  };
})();`;

/**
 * Opens a page that looks like Gemini and injects the built extension.
 * @param {import('puppeteer-core').Browser} browser
 */
export async function openGemini(browser, { html = fixture(), url = 'https://gemini.google.com/app/abc123def456', theme = 'dark-theme', seed = {}, claimWelcome = false } = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(`[${m.type()}] ${m.text()}`); });
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url() === url) req.respond({ status: 200, contentType: 'text/html', body: html });
    else req.respond({ status: 204, body: '' });
  });
  await page.evaluateOnNewDocument(CHROME_STUB);
  await page.evaluateOnNewDocument((s, c) => { Object.assign(window.__store, s); window.__claimWelcome = c; }, seed, claimWelcome);
  await page.exposeFunction('__loadVendor', async () => {
    await page.addScriptTag({ path: dist('vendor/html2canvas.min.js') });
    await page.addScriptTag({ path: dist('vendor/jspdf.umd.min.js') });
    return { ok: true };
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate((t) => { document.body.className = t; }, theme);
  await page.addStyleTag({ path: dist('content.css') });
  await page.addScriptTag({ path: dist('content.js') });
  const settle = async (ms = 700) => new Promise((r) => setTimeout(r, ms));
  await settle(1500);
  return { page, errors, settle };
}
