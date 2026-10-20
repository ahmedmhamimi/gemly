/**
 * Copy text to the clipboard. The async Clipboard API can be refused (page
 * not focused, permissions policy), so fall back to a hidden textarea +
 * execCommand('copy'). Resolves true/false; never throws.
 */
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  const active = document.activeElement;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.setAttribute('data-gemly-owned', '');
  ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;';
  document.body.appendChild(ta);
  let ok;
  try {
    ta.select();
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    ta.remove();
    if (active && typeof active.focus === 'function') active.focus({ preventScroll: true });
  }
  return ok;
}
