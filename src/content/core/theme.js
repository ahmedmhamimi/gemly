/**
 * Mirrors Gemini's light/dark mode and text direction onto <html> so the
 * stylesheet can key off `data-gl-theme` / `data-gl-dir`. Re-checked on every
 * scan because both can change at runtime without a reload.
 */
import { bus } from './events.js';

let lastMode = null;
let lastDir = null;

export function detectDark() {
  const html = document.documentElement;
  const body = document.body;
  if (body?.classList.contains('dark-theme') || html.classList.contains('dark-theme')) return true;
  if (body?.classList.contains('light-theme') || html.classList.contains('light-theme')) return false;
  if (html.classList.contains('dark') || body?.classList.contains('dark')) return true;
  const attr = html.getAttribute('data-theme') || html.getAttribute('theme');
  if (attr === 'dark') return true;
  if (attr === 'light') return false;

  // Ground truth: the page's actual rendered background.
  const rgb = getComputedStyle(body || html).backgroundColor.match(/[\d.]+/g);
  if (rgb && rgb.length >= 3 && !(rgb.length >= 4 && Number(rgb[3]) === 0)) {
    const [r, g, b] = rgb.map(Number);
    return 0.299 * r + 0.587 * g + 0.114 * b < 128;
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function detectDirection() {
  const body = document.body;
  const dir = (body && getComputedStyle(body).direction) || document.documentElement.dir || 'ltr';
  return dir === 'rtl' ? 'rtl' : 'ltr';
}

export function syncTheme() {
  const mode = detectDark() ? 'dark' : 'light';
  const dir = detectDirection();
  if (dir !== lastDir) {
    lastDir = dir;
    document.documentElement.setAttribute('data-gl-dir', dir);
  }
  if (mode === lastMode) return;
  lastMode = mode;
  document.documentElement.setAttribute('data-gl-theme', mode);
  document.querySelectorAll('[data-gemly-host]').forEach((h) => h.setAttribute('data-theme', mode));
  bus.emit('theme', { mode });
}

export function resetTheme() {
  lastMode = lastDir = null;
}
