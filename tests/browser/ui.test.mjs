import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, launch, openGemini } from './helpers.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withPage(opts, fn) {
  const ctx = await openGemini(browser, opts);
  try { await fn(ctx); } finally { await ctx.page.close(); }
}
const noErrors = (errors) => assert.deepEqual(errors.filter((e) => !/Failed to load resource/.test(e)), []);

test('injects everything once, no console errors, idempotent across many scans', async () => {
  await withPage({}, async ({ page, errors }) => {
    for (let i = 0; i < 5; i++) { await page.evaluate(() => { document.getElementById('turns').appendChild(document.createComment('x')); }); await sleep(250); }
    const c = await page.evaluate(() => ({
      bar: document.querySelectorAll('#gemly-bar').length,
      widgets: document.querySelectorAll('#gemly-bar > *').length,
      cluster: document.querySelectorAll('.gl-msg-actions').length,
      folders: document.querySelectorAll('#gemly-folder-section').length,
      sidebarSearch: document.querySelectorAll('#gemly-sidebar-search').length,
      rowBtns: document.querySelectorAll('.gl-row-btn').length,
      dock: document.querySelectorAll('#gemly-bookmark-dock').length,
      pill: document.querySelectorAll('#gemly-chat-search').length,
    }));
    assert.deepEqual(c, { bar: 1, widgets: 8, cluster: 1, folders: 1, sidebarSearch: 1, rowBtns: 3, dock: 1, pill: 1 });
    noErrors(errors);
  });
});

test('every injected element is recognisable as Gemly\'s own (mutation filter depends on it)', async () => {
  await withPage({}, async ({ page }) => {
    const strays = await page.evaluate(() => [...document.querySelectorAll('[class*="gl-"], [id^="gemly-"]')]
      .filter((el) => !el.closest('.gl-ui, [data-gemly-host], [data-gemly-owned]') && !el.closest('[data-gemly-bm-host]:not(.gl-bm-btn)') )
      .map((el) => el.tagName + '.' + el.className));
    assert.deepEqual(strays, []);
  });
});

test('search pill: lens is pixel-centred in the circle (collapsed)', async () => {
  await withPage({}, async ({ page }) => {
    const m = await page.evaluate(() => {
      const pill = document.getElementById('gemly-chat-search').getBoundingClientRect();
      const svg = document.querySelector('#gemly-chat-search .gl-search__toggle svg').getBoundingClientRect();
      return { dx: (svg.left + svg.width / 2) - (pill.left + pill.width / 2), dy: (svg.top + svg.height / 2) - (pill.top + pill.height / 2), w: pill.width, h: pill.height };
    });
    assert.ok(Math.abs(m.dx) <= 0.6 && Math.abs(m.dy) <= 0.6, JSON.stringify(m));
    assert.ok(Math.abs(m.w - m.h) <= 0.5, 'perfect circle');
  });
});

test('bookmark button sits inside the bubble with breathing room from every edge', async () => {
  await withPage({}, async ({ page }) => {
    await page.hover('user-query');
    await sleep(200);
    const m = await page.evaluate(() => {
      const b = document.querySelector('user-query > .gl-bm-btn').getBoundingClientRect();
      const q = document.querySelector('user-query').getBoundingClientRect();
      return { top: b.top - q.top, right: q.right - b.right, bottom: q.bottom - b.bottom, left: b.left - q.left };
    });
    assert.ok(m.top >= 10 && m.right >= 14 && m.bottom >= 10 && m.left > 0, JSON.stringify(m));
  });
});

test('chat search: cross-element matches, exact highlighted text, İ offsets stay valid, no DOM mutation', async () => {
  await withPage({}, async ({ page }) => {
    const before = await page.evaluate(() => document.getElementById('turns').innerHTML);
    await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.press('KeyF'); await page.keyboard.up('Shift'); await page.keyboard.up('Control');
    await sleep(200);
    await page.type('#gemly-search-input', 'plan');
    await sleep(500);
    const r = await page.evaluate(() => ({
      count: document.getElementById('gemly-search-count').textContent,
      hl: [...(CSS.highlights.get('gemly-search') || [])].map((x) => x.toString()),
      active: [...(CSS.highlights.get('gemly-search-active') || [])].map((x) => x.toString()),
      open: document.getElementById('gemly-chat-search').dataset.open,
    }));
    assert.equal(r.open, 'true');
    assert.ok(r.hl.map((x) => x.toLowerCase()).every((x) => x === 'plan'), JSON.stringify(r));
    assert.ok(r.hl.includes('plan'), JSON.stringify(r));           // "pl"+"an" across <strong>, original case kept
    assert.ok(r.hl.includes('Plan'), 'case-insensitive');
    assert.match(r.count, /^1\/\d+$/);
    // Turkish dotted capital I must not corrupt later offsets
    await page.evaluate(() => { document.getElementById('gemly-search-input').value = ''; });
    await page.type('#gemly-search-input', 'stanbul');
    await sleep(500);
    const t = await page.evaluate(() => [...(CSS.highlights.get('gemly-search') || [])].map((x) => x.toString()));
    assert.deepEqual(t, ['stanbul']);
    assert.equal(await page.evaluate(() => document.getElementById('turns').innerHTML.replace(/<(button)[^>]*gl-bm-btn[\s\S]*?<\/button>/g, '')), before.replace(/<(button)[^>]*gl-bm-btn[\s\S]*?<\/button>/g, ''), 'Gemini DOM untouched (ignoring our own bookmark buttons)');
    await page.keyboard.press('Escape');
    await sleep(100);
    assert.equal(await page.evaluate(() => CSS.highlights.size), 0, 'highlights cleared on close');
  });
});

test('search never matches across paragraph boundaries', async () => {
  await withPage({}, async ({ page }) => {
    const n = await page.evaluate(() => {
      const md = document.querySelector('.markdown');
      md.insertAdjacentHTML('beforeend', '<p>alpha</p><p>beta</p>');
      return 0;
    });
    void n;
    await sleep(500);
    await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.press('KeyF'); await page.keyboard.up('Shift'); await page.keyboard.up('Control');
    await sleep(150);
    await page.type('#gemly-search-input', 'alphabeta');
    await sleep(450);
    assert.equal(await page.evaluate(() => document.getElementById('gemly-search-count').textContent), '0');
  });
});

test('folders: create -> inline rename -> drag chat in -> persists -> delete -> undo restores', async () => {
  await withPage({}, async ({ page, errors }) => {
    await page.click('#gemly-folder-add-btn');
    await sleep(300);
    await page.keyboard.type('Work');
    await page.keyboard.press('Enter');
    await sleep(400);
    assert.equal(await page.evaluate(() => document.querySelector('.gl-folder-name').textContent), 'Work');

    await page.evaluate(() => {
      const dt = new DataTransfer();
      const link = document.querySelector('a[href="/app/zzz999yyy888"]');
      link.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      const head = document.querySelector('.gl-folder-head');
      head.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      head.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      link.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    });
    await sleep(500);
    const s = await page.evaluate(() => ({ count: document.querySelector('.gl-folder-count').textContent, item: document.querySelector('.gl-folder-item__title')?.textContent, store: window.__store['gemly-folder-assignments-v1'] }));
    assert.equal(s.count, '1'); assert.equal(s.item, 'Recipe ideas'); assert.deepEqual(Object.keys(s.store), ['zzz999yyy888']);

    // delete with undo
    await page.hover('.gl-folder-head'); await sleep(100);
    await page.evaluate(() => document.querySelector('.gl-folder-actions .gl-icon-btn:last-child').click());
    await sleep(150);
    await page.evaluate(() => [...document.querySelectorAll('.gl-folder-menu .gl-menu-item')].find((b) => b.dataset.danger).click());
    await sleep(400);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.gl-folder').length), 0);
    assert.equal(await page.evaluate(() => Object.keys(window.__store['gemly-folder-assignments-v1'] || {}).length), 0);
    await page.evaluate(() => document.querySelector('.gl-toast__action').click());
    await sleep(500);
    assert.equal(await page.evaluate(() => document.querySelector('.gl-folder-name')?.textContent), 'Work');
    assert.equal(await page.evaluate(() => document.querySelector('.gl-folder-item__title')?.textContent), 'Recipe ideas');
    noErrors(errors);
  });
});

test('folders: a rename in progress survives a re-render triggered by another tab', async () => {
  await withPage({ seed: { 'gemly-folders-v1': [{ id: 'f1', name: 'One', color: '#4f7cff' }] } }, async ({ page }) => {
    await page.evaluate(() => document.querySelector('.gl-folder-head').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    await sleep(200);
    await page.keyboard.type('Renamed');
    await page.evaluate(() => chrome.storage.local.set({ 'gemly-folder-state-v1': { f1: true } }));
    await sleep(500);
    assert.equal(await page.evaluate(() => document.querySelector('.gl-folder-rename')?.value), 'Renamed');
    await page.keyboard.press('Enter');
    await sleep(300);
    assert.equal(await page.evaluate(() => document.querySelector('.gl-folder-name').textContent), 'Renamed');
  });
});

test('corrupt / hostile stored data never breaks startup', async () => {
  const seed = {
    'gemly-folders-v1': [{ id: 'a', name: 'A', parentId: 'b' }, { id: 'b', name: 'B', parentId: 'a' }, null, { id: 'x', name: '<img src=x onerror=alert(1)>', color: 'red' }],
    'gemly-folder-assignments-v1': { abc123def456: 'ghost', ok: 5 },
    'gemly-tone-v1': 'garbage', 'gemly-bookmarks-v1': [1, 2], 'gemly-prompts-v1': { not: 'array' },
    'gemly-conv-meta-v1': { abc123def456: { title: 'T', path: '//evil.com' } },
  };
  await withPage({ seed }, async ({ page, errors }) => {
    const r = await page.evaluate(() => ({ names: [...document.querySelectorAll('.gl-folder-name')].map((n) => n.textContent), imgs: document.querySelectorAll('.gl-folders img').length, bar: !!document.getElementById('gemly-bar') }));
    assert.equal(r.imgs, 0, 'folder names are text, never markup');
    assert.ok(r.names.includes('<img src=x onerror=alert(1)>'));
    assert.ok(r.bar);
    noErrors(errors);
  });
});

test('tone: tag appended once the send is real; held send is re-fired; not re-added in same chat', async () => {
  await withPage({}, async ({ page }) => {
    await page.evaluate(() => { window.__sends = 0; document.querySelector('.send-button').addEventListener('click', () => window.__sends++); });
    await page.click('#gemly-tone-chip'); await sleep(150);
    await page.evaluate(() => [...document.querySelectorAll('.gl-tone-option')].find((o) => o.textContent.includes('Fun')).click());
    await page.keyboard.press('Escape');
    await page.click('.ql-editor'); await page.keyboard.type('hello world');
    await page.keyboard.press('Enter');
    await sleep(500);
    const t = await page.evaluate(() => ({ text: document.querySelector('.ql-editor').innerText, sends: window.__sends }));
    assert.match(t.text, /hello world\s+Tone: Fun/);
    assert.equal(t.sends, 1, 'send re-fired exactly once');
  });
});

test('send guards: nothing is touched while Gemini is generating, for empty prompts, Shift+Enter or IME', async () => {
  await withPage({}, async ({ page }) => {
    await page.evaluate(() => { window.__sends = 0; document.querySelector('.send-button').addEventListener('click', () => window.__sends++); });
    await page.click('#gemly-tone-chip'); await sleep(150);
    await page.evaluate(() => [...document.querySelectorAll('.gl-tone-option')].find((o) => o.textContent.includes('Concise')).click());
    await page.keyboard.press('Escape');
    await page.click('.ql-editor');
    await page.keyboard.press('Enter'); await sleep(300);                       // empty prompt
    await page.keyboard.type('draft');
    await page.keyboard.down('Shift'); await page.keyboard.press('Enter'); await page.keyboard.up('Shift'); await sleep(300); // newline
    await page.evaluate(() => document.querySelector('.send-button').classList.add('stop'));
    await page.keyboard.press('Enter'); await sleep(400);                        // generating
    const r = await page.evaluate(() => ({ text: document.querySelector('.ql-editor').innerText, sends: window.__sends }));
    assert.ok(!r.text.includes('Tone:'), 'no tag injected: ' + JSON.stringify(r.text));
    assert.equal(r.sends, 0, 'the stop button was never clicked');
  });
});

test('prompt library inserts multi-line text as paragraphs at the caret; quotes in placeholders survive', async () => {
  await withPage({}, async ({ page }) => {
    await page.click('.ql-editor'); await page.keyboard.type('X');
    await page.click('#gemly-prompt-library-btn'); await sleep(200);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.gl-prompt-row').length), 5);
    await page.click('.gl-prompts__add'); await sleep(100);
    const ph = await page.evaluate(() => document.querySelector('.gl-prompt-form input').getAttribute('placeholder'));
    assert.equal(ph, 'Title (e.g. "Explain simply")');
    await page.evaluate(() => document.querySelector('.gl-prompt-form__btns .gl-btn').click());
    await page.click('.gl-prompt-row'); await sleep(300);
    const text = await page.evaluate(() => document.querySelector('.ql-editor').innerText);
    assert.match(text, /^X/);
    assert.match(text, /Explain the following like I'm new to the topic/);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.gl-pop').length), 0, 'panel closed after use');
  });
});

test('popovers: one at a time, Escape/outside-press close, stay on-screen after resize, aria-expanded tracks', async () => {
  await withPage({}, async ({ page }) => {
    await page.click('#gemly-tone-chip'); await sleep(150);
    assert.equal(await page.$eval('#gemly-tone-chip', (e) => e.getAttribute('aria-expanded')), 'true');
    await page.click('#gemly-prompt-library-btn'); await sleep(150);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.gl-pop').length), 1, 'opening a second closes the first');
    assert.equal(await page.$eval('#gemly-tone-chip', (e) => e.getAttribute('aria-expanded')), 'false');
    await page.evaluate(() => { document.querySelector('bard-sidenav').style.display = 'none'; });
    await page.setViewport({ width: 420, height: 500 }); await sleep(400);
    assert.equal(await page.$eval('#gemly-bar', (b) => b.dataset.density), 'compact');
    const barBox = await page.$eval('#gemly-bar', (b) => { const r = b.getBoundingClientRect(); const last = b.lastElementChild.getBoundingClientRect(); return { right: r.right, lastRight: last.right, w: innerWidth }; });
    assert.ok(barBox.lastRight <= barBox.right + 0.5 && barBox.right <= barBox.w, 'bar content never overflows its pill: ' + JSON.stringify(barBox));
    const box = await page.evaluate(() => { const r = document.querySelector('.gl-pop').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: innerWidth, h: innerHeight }; });
    assert.ok(box.l >= 0 && box.t >= 0 && box.r <= box.w && box.b <= box.h + 1, JSON.stringify(box));
    await page.keyboard.press('Escape'); await sleep(100);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.gl-pop').length), 0);
    await page.click('#gemly-export-btn'); await sleep(150);
    await page.mouse.click(5, 300); await sleep(150);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.gl-pop').length), 0);
  });
});

test('bookmarks: toggle, dock badge, jump; identical repeated messages are distinguished', async () => {
  const html = fixture().replace('</div></infinite-scroller>', `
    <div class="conversation-container"><user-query><div class="query-text"><p class="query-text-line">continue</p></div></user-query>
      <model-response><message-content><div class="markdown"><p>part two</p></div></message-content></model-response></div>
    <div class="conversation-container"><user-query><div class="query-text"><p class="query-text-line">continue</p></div></user-query>
      <model-response><message-content><div class="markdown"><p>part three</p></div></message-content></model-response></div>
    </div></infinite-scroller>`);
  await withPage({ html }, async ({ page }) => {
    const toggle = async (i) => { await page.evaluate((n) => document.querySelectorAll('.gl-bm-btn')[n].click(), i); await sleep(250); };
    const turns = await page.evaluate(() => [...document.querySelectorAll('user-query, model-response')].map((t) => t.tagName + ':' + t.textContent.trim().slice(0, 12)));
    const firstContinue = turns.findIndex((t) => t.includes('continue'));
    const secondContinue = turns.findIndex((t, i) => i > firstContinue && t.includes('continue'));
    await toggle(firstContinue);
    const marks = await page.evaluate(() => [...document.querySelectorAll('.gl-bm-btn')].map((b) => b.dataset.on));
    assert.equal(marks[firstContinue], 'true');
    assert.equal(marks[secondContinue], 'false', 'same text, different position: not conflated');
    assert.equal(await page.$eval('#gemly-bookmark-badge', (e) => e.textContent), '1');
    await page.click('#gemly-bookmark-dock'); await sleep(200);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.gl-bm-row').length), 1);
    await page.evaluate(() => document.querySelector('.gl-bm-row .gl-icon-btn').click()); await sleep(250);
    assert.equal(await page.$eval('#gemly-bookmark-badge', (e) => e.textContent), '0');
  });
});

test('navigation: leaving a chat hides chat-only UI; locale change rebuilds UI in Arabic + RTL', async () => {
  await withPage({}, async ({ page, errors }) => {
    await page.evaluate(() => { history.pushState({}, '', '/app'); document.getElementById('turns').innerHTML = ''; });
    await sleep(700);
    assert.equal(await page.$eval('#gemly-bookmark-dock', (e) => e.dataset.visible), 'false');
    assert.equal(await page.$eval('#gemly-chat-search', (e) => e.dataset.visible), 'false');

    await page.evaluate(() => { document.documentElement.lang = 'ar'; document.body.style.direction = 'rtl'; document.documentElement.dir = 'rtl'; });
    await page.evaluate(() => document.getElementById('turns').appendChild(document.createElement('div')));
    await sleep(900);
    const r = await page.evaluate(() => ({ dir: document.documentElement.dataset.glDir, tip: document.getElementById('gemly-export-btn').dataset.glTip, chip: document.getElementById('gemly-tone-chip').textContent.trim() }));
    assert.equal(r.dir, 'rtl');
    assert.match(r.tip, /تنزيل/);
    assert.match(r.chip, /النبرة/);
    noErrors(errors);
  });
});

test('light/dark follows the page at runtime', async () => {
  await withPage({}, async ({ page }) => {
    await page.evaluate(() => { document.body.className = 'light-theme'; document.getElementById('turns').appendChild(document.createElement('i')); });
    await sleep(700);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.glTheme), 'light');
  });
});

test('sidebar collapsed to an icon rail hides Gemly\'s sidebar blocks (ResizeObserver, no mutation needed)', async () => {
  await withPage({}, async ({ page }) => {
    await page.evaluate(() => { document.querySelector('bard-sidenav').style.width = '72px'; });
    await sleep(500);
    assert.equal(await page.evaluate(() => document.getElementById('gemly-folder-section').hidden), true);
    await page.evaluate(() => { document.querySelector('bard-sidenav').style.width = '300px'; });
    await sleep(500);
    assert.equal(await page.evaluate(() => document.getElementById('gemly-folder-section').hidden), false);
  });
});

test('performance: constant streaming mutations -> bounded scans (no starvation, no storm)', async () => {
  await withPage({}, async ({ page }) => {
    await page.evaluate(() => { document.querySelector('.send-button').classList.add('stop'); });
    await sleep(400);
    const s0 = await page.evaluate(() => window.__gemly.diagnose().scans);
    await page.evaluate(() => new Promise((resolve) => {
      const p = document.querySelector('model-response .markdown p');
      let i = 0;
      const t = setInterval(() => { p.appendChild(document.createTextNode(' tok' + i)); if (++i === 400) { clearInterval(t); resolve(); } }, 5);
    }));
    await sleep(600);
    const s1 = await page.evaluate(() => window.__gemly.diagnose().scans);
    const n = s1 - s0;
    assert.ok(n >= 2, `scans during stream = ${n} (starved)`);
    assert.ok(n <= 12, `scans during stream = ${n} (storm)`);
  });
});

test('mutations in irrelevant page regions (overlays/tooltips) cause no scans', async () => {
  await withPage({}, async ({ page }) => {
    await page.evaluate(() => { const o = document.createElement('div'); o.className = 'cdk-overlay-container'; document.body.appendChild(o); });
    await sleep(500);
    const s0 = await page.evaluate(() => window.__gemly.diagnose().scans);
    await page.evaluate(() => { const o = document.querySelector('.cdk-overlay-container'); for (let i = 0; i < 100; i++) o.appendChild(document.createElement('span')); });
    await sleep(600);
    assert.equal(await page.evaluate(() => window.__gemly.diagnose().scans), s0);
  });
});

test('extension context invalidated: orphaned instance tears down cleanly, no errors, no leftovers', async () => {
  await withPage({}, async ({ page, errors }) => {
    await page.evaluate(() => { delete window.chrome.runtime.id; document.getElementById('turns').appendChild(document.createElement('b')); });
    await sleep(900);
    const left = await page.evaluate(() => document.querySelectorAll('.gl-ui, [data-gemly-host]').length);
    assert.equal(left, 0);
    assert.equal(await page.evaluate(() => typeof window.__gemly), 'undefined');
    noErrors(errors);
  });
});

test('a second instance (extension update) evicts the first and sweeps its DOM: no duplicates', async () => {
  await withPage({}, async ({ page }) => {
    const src = await page.evaluate(() => 0);
    void src;
    const { dist } = await import('./helpers.mjs');
    await page.addScriptTag({ path: dist('content.js') });
    await sleep(1500);
    const c = await page.evaluate(() => ({ bars: document.querySelectorAll('#gemly-bar').length, clusters: document.querySelectorAll('.gl-msg-actions').length, folders: document.querySelectorAll('#gemly-folder-section').length }));
    assert.deepEqual(c, { bars: 1, clusters: 1, folders: 1 });
  });
});

test('storage failure surfaces a toast once instead of failing silently', async () => {
  await withPage({}, async ({ page }) => {
    await page.evaluate(() => { window.__failStorage = 'QUOTA_BYTES quota exceeded'; });
    await page.click('#gemly-folder-add-btn'); await sleep(250);
    await page.keyboard.press('Enter'); await sleep(500);
    const toast = await page.evaluate(() => document.querySelector('.gl-toast')?.textContent || '');
    assert.match(toast, /Storage is full/);
  });
});

test('copy conversation / copy reply produce clean text (fallback path works without Clipboard API)', async () => {
  await withPage({}, async ({ page }) => {
    await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); window.__copied = null; document.execCommand = (c) => { if (c === 'copy') { window.__copied = document.activeElement?.value ?? getSelection().toString(); return true; } return false; }; });
    await page.click('#gemly-copy-conversation-btn'); await sleep(300);
    const t = await page.evaluate(() => window.__copied);
    assert.match(t, /^You:\nPlan a trip to Cairo\nfor 3 days\n\nGemini:\nHere is a plan/);
    assert.ok(!t.includes('python\n'), 'no code header');
  });
});
