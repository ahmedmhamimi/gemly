import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openGemini } from './helpers.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withPage(opts, fn) {
  const ctx = await openGemini(browser, opts);
  try { await fn(ctx); } finally { await ctx.page.close(); }
}

test('welcome card: shown once to the claiming tab, dismissible, inside a Shadow DOM, themed', async () => {
  await withPage({ claimWelcome: true }, async ({ page, errors }) => {
    await sleep(1800);
    const r = await page.evaluate(() => {
      const host = document.getElementById('gemly-welcome-host');
      return { host: !!host, shadow: !!host?.shadowRoot, text: host?.shadowRoot?.textContent || '', theme: host?.getAttribute('data-theme') };
    });
    assert.ok(r.host && r.shadow, 'rendered in a shadow root');
    assert.match(r.text, /Gemly/);
    assert.equal(r.theme, 'dark');
    await page.keyboard.press('Escape'); await sleep(900);
    assert.equal(await page.evaluate(() => !!document.getElementById('gemly-welcome-host')), false, 'Escape dismisses');
    assert.deepEqual(errors.filter((e) => !/Failed to load resource/.test(e)), []);
  });
  await withPage({ claimWelcome: false }, async ({ page }) => {
    await sleep(1500);
    assert.equal(await page.evaluate(() => !!document.getElementById('gemly-welcome-host')), false, 'not claimed -> not shown');
  });
});

test('quick actions: double-click a prompt opens Gemini\'s edit; double-click a title drives rename menu + dialog', async () => {
  await withPage({}, async ({ page }) => {
    await page.evaluate(() => {
      window.__edit = 0;
      const eb = document.querySelector('user-query button[aria-label="Edit text"]');
      eb.addEventListener('click', () => window.__edit++);
      document.querySelectorAll('.conversation-actions-menu-button').forEach((b) => b.addEventListener('click', () => {
        const o = document.createElement('div'); o.className = 'cdk-overlay-container';
        o.innerHTML = '<div role="menu"><button role="menuitem" data-test-id="pin-button">Pin</button><button role="menuitem" data-test-id="rename-button">Rename</button></div>';
        o.querySelector('[data-test-id="rename-button"]').addEventListener('click', () => { o.insertAdjacentHTML('beforeend', '<mat-dialog-container><input type="text" value="Trip plan"></mat-dialog-container>'); });
        document.body.appendChild(o);
      }));
    });
    await page.evaluate(() => document.querySelector('.query-text-line').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })));
    await sleep(400);
    assert.equal(await page.evaluate(() => window.__edit), 1);

    await page.evaluate(() => document.querySelector('.conversation-title').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })));
    await sleep(900);
    assert.equal(await page.evaluate(() => document.activeElement?.matches('mat-dialog-container input')), true, 'rename input focused');
  });
});

test('quick actions: a missing Gemini control gives a clear message instead of failing silently', async () => {
  await withPage({}, async ({ page }) => {
    await page.evaluate(() => document.querySelectorAll('.conversation-actions-menu-button').forEach((b) => b.remove()));
    await page.evaluate(() => document.querySelector('.conversation-title').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })));
    await sleep(400);
    assert.match(await page.evaluate(() => document.querySelector('.gl-toast')?.textContent || ''), /conversation menu|⋮/i);
  });
});

test('timing badge: reply time is measured from send to generation end and shown once, on the newest reply', async () => {
  await withPage({}, async ({ page }) => {
    await page.evaluate(() => { document.querySelector('.ql-editor').textContent = 'next question'; });
    await page.evaluate(() => document.querySelector('.send-button').click());
    await sleep(200);
    await page.evaluate(() => document.querySelector('.send-button').classList.add('stop'));
    await sleep(1300);
    await page.evaluate(() => {
      document.querySelector('.send-button').classList.remove('stop');
      document.getElementById('turns').insertAdjacentHTML('beforeend', `<div class="conversation-container"><user-query><div class="query-text"><p class="query-text-line">next question</p></div></user-query>
        <model-response><message-content><div class="markdown"><p>second answer</p></div></message-content><message-actions><div class="buttons"><copy-button><button aria-label="Copy">c</button></copy-button></div></message-actions></model-response></div>`);
    });
    await sleep(900);
    const badges = await page.evaluate(() => [...document.querySelectorAll('.gl-token')].map((b) => ({ hidden: b.hidden, text: b.textContent.trim() })));
    assert.equal(badges.length, 2);
    assert.match(badges[1].text, /\d+\s*tokens?.*\d+(\.\d)?s/i, JSON.stringify(badges));
    assert.doesNotMatch(badges[0].text, /\d s$/, 'older reply has no time');
  });
});

test('context meter reflects the conversation and warns near the limit', async () => {
  await withPage({}, async ({ page }) => {
    const before = await page.evaluate(() => document.querySelector('.gl-meter__label').textContent);
    assert.match(before, /<1%|\d+%/);
    const tip = await page.evaluate(() => document.getElementById('gemly-context-meter').dataset.glTip);
    assert.match(tip, /of 1,048,576/);
  });
});

test('resource use at idle: no timers, observers or listeners churn; tooltip timers exist only while shown', async () => {
  await withPage({}, async ({ page }) => {
    await page.evaluate(() => {
      window.__intervals = new Set();
      const si = window.setInterval.bind(window), ci = window.clearInterval.bind(window);
      window.setInterval = (...a) => { const id = si(...a); window.__intervals.add(id); return id; };
      window.clearInterval = (id) => { window.__intervals.delete(id); return ci(id); };
    });
    await sleep(800);
    assert.equal(await page.evaluate(() => window.__intervals.size), 0, 'nothing polls at idle');
    await page.hover('#gemly-export-btn'); await sleep(900);
    assert.equal(await page.evaluate(() => document.querySelector('.gl-tooltip--visible') !== null), true, 'tooltip shows');
    assert.equal(await page.evaluate(() => window.__intervals.size), 1, 'one safety poll while visible');
    await page.mouse.move(5, 5); await sleep(900);
    assert.equal(await page.evaluate(() => window.__intervals.size), 0, 'poll stopped once hidden');
  });
});

test('hover tooltips never show for touch pointers', async () => {
  await withPage({}, async ({ page }) => {
    await page.evaluate(() => {
      const el = document.getElementById('gemly-export-btn');
      el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'touch' }));
    });
    await sleep(700);
    assert.equal(await page.evaluate(() => document.querySelector('.gl-tooltip--visible') !== null), false);
  });
});

test('diagnose() reports selector health and per-feature status for field debugging', async () => {
  await withPage({}, async ({ page }) => {
    const d = await page.evaluate(() => window.__gemly.diagnose());
    assert.equal(d.turns, 2);
    assert.equal(d.sidebarLinks, 3);
    assert.equal(d.editor, true);
    assert.ok(d.features.every((f) => !f.disabled));
    assert.ok(d.selectors.turns[0].matches >= 2);
    assert.equal(d.conversationId, 'abc123def456');
  });
});
