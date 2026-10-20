/**
 * Lazy loader for the PDF engines (html2canvas + jsPDF, ~700 KB). They are
 * NOT injected with the content script - that would cost every Gemini page
 * load. The background worker injects them into this tab's isolated world the
 * first time a PDF is requested.
 */
import { MSG } from '../../../core/config.js';

let loading = null;

const ready = () => !!(window.jspdf?.jsPDF && typeof window.html2canvas === 'function');

export function ensurePdfLibs() {
  if (ready()) return Promise.resolve(true);
  loading ??= chrome.runtime
    .sendMessage({ type: MSG.loadVendor })
    .then((res) => !!res?.ok && ready())
    .catch(() => false)
    .finally(() => {
      loading = null;
    });
  return loading;
}
