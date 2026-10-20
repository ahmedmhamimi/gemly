/**
 * Progress bar + status line for long jobs. Determinate when a fraction is
 * given, indeterminate (animated) otherwise. aria-valuenow follows the value.
 */
import { escapeHtml } from '../util/text.js';

export function createProgress() {
  const el = document.createElement('div');
  el.className = 'gl-ui gl-progress';
  el.innerHTML =
    '<div class="gl-progress__track" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div class="gl-progress__fill"></div></div>' +
    '<div class="gl-progress__label" aria-live="polite"></div>';
  const track = el.querySelector('.gl-progress__track');
  const fill = el.querySelector('.gl-progress__fill');
  const label = el.querySelector('.gl-progress__label');
  return {
    el,
    /** @param {number|null} fraction 0..1, or null for indeterminate */
    set(fraction, text = '') {
      if (fraction == null) {
        el.dataset.indeterminate = 'true';
        track.removeAttribute('aria-valuenow');
      } else {
        const pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
        delete el.dataset.indeterminate;
        fill.style.width = `${pct}%`;
        track.setAttribute('aria-valuenow', String(pct));
      }
      label.innerHTML = escapeHtml(text);
    },
    state(s) {
      el.dataset.state = s; // 'running' | 'done' | 'error'
    },
  };
}
