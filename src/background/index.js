/**
 * MV3 service worker.
 *
 *  1. First install: remember that a welcome is pending, then take the person
 *     to Gemini - reloading open Gemini tabs (so the content script attaches)
 *     and focusing one, or opening a new tab.
 *  2. Hand the one-time welcome splash to exactly one tab.
 *  3. Inject the PDF engines into a tab on demand (they are not loaded with
 *     every page - see content/features/export/pdf/vendor.js).
 *  4. Serve the chat archive (IndexedDB in this worker, see archive.js).
 *
 * Only messages from this extension's own content script on gemini.google.com
 * are honoured. There is no uninstall survey and no network access.
 */
import { BG_KEYS, MSG } from '../content/core/config.js';
import { sharedArchive } from './archive.js';

const GEMINI_URL = 'https://gemini.google.com/app';
const GEMINI_ORIGIN = 'https://gemini.google.com/';
const VENDOR_FILES = ['vendor/html2canvas.min.js', 'vendor/jspdf.umd.min.js'];

async function goToGemini() {
  const tabs = await chrome.tabs.query({ url: `${GEMINI_ORIGIN}*` });
  if (!tabs.length) {
    await chrome.tabs.create({ url: GEMINI_URL, active: true });
    return;
  }
  const target =
    tabs.find((t) => t.active && t.highlighted) ||
    tabs.find((t) => t.active) ||
    [...tabs].sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];

  await Promise.all(tabs.map((t) => chrome.tabs.reload(t.id).catch(() => {})));
  try {
    await chrome.windows.update(target.windowId, { focused: true });
    await chrome.tabs.update(target.id, { active: true });
  } catch (err) {
    console.debug('Gemly: could not focus Gemini tab', err);
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason !== 'install') return;
  // Flags first, so a content script can never load and find nothing.
  await chrome.storage.local.set({
    [BG_KEYS.welcomePending]: true,
    [BG_KEYS.reviewState]: {
      installedAt: Date.now(),
      score: 0,
      activeDays: [],
      asks: 0,
      status: 'pending',
      nextEligibleAt: 0,
    },
  });
  await goToGemini();
});

// Several Gemini tabs reload at once on install and each asks to show the
// splash: claims are processed strictly one at a time and the first wins.
let claimQueue = Promise.resolve();

function claimWelcome() {
  claimQueue = claimQueue.then(async () => {
    const res = await chrome.storage.local.get(BG_KEYS.welcomePending);
    if (res[BG_KEYS.welcomePending] === true) {
      await chrome.storage.local.set({ [BG_KEYS.welcomePending]: false });
      return { claimed: true };
    }
    return { claimed: false };
  });
  return claimQueue;
}

async function loadVendor(sender) {
  await chrome.scripting.executeScript({
    target: { tabId: sender.tab.id, frameIds: [sender.frameId ?? 0] },
    files: VENDOR_FILES,
    world: 'ISOLATED',
  });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const trusted = sender.id === chrome.runtime.id && sender.tab && String(sender.tab.url || sender.url || '').startsWith(GEMINI_ORIGIN);
  if (!trusted || !msg) return false;

  const handlers = {
    [MSG.claimWelcome]: claimWelcome,
    [MSG.loadVendor]: () => loadVendor(sender),
    // Always resolves to { ok, ... }; the archive never throws into the messaging layer.
    [MSG.archive]: () => sharedArchive().handle(msg.op, msg.args),
  };
  const handler = handlers[msg.type];
  if (!handler) return false;
  const work = handler();

  work.then(sendResponse).catch((err) => {
    console.warn('Gemly background:', msg.type, err);
    sendResponse({ ok: false, claimed: false });
  });
  return true; // async response
});
