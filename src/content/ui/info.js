/**
 * The little "i" next to a setting. Hover it (or focus it with the keyboard, or tap it)
 * and a short plain-language explanation appears; it stays while the pointer stays.
 * The text comes from the caller (already localised); it is set as an attribute, never as HTML.
 */
import { icon } from './icons.js';

/** @param {string} text @returns {HTMLButtonElement} */
export function infoIcon(text) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'gl-info';
  b.setAttribute('aria-label', text);
  b.setAttribute('data-gl-tip', text);
  b.setAttribute('data-gl-tip-keep', '');
  b.innerHTML = icon('info', 14);
  // Inside a Settings row (a <label>) a click must not flip the switch.
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  return b;
}
