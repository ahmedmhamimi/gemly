/**
 * Toasts and the persistent "working…" pill. Replace blocking alert() so
 * nothing ever steals focus from the chat. One toast at a time (a new one
 * replaces the old), polite live-region semantics, optional action button.
 */
import { icon } from './icons.js';
import { escapeHtml } from '../util/text.js';

let toastEl = null;
let toastTimer = null;
let toastRemoveTimer = null;

function dismissToast() {
  clearTimeout(toastTimer);
  clearTimeout(toastRemoveTimer);
  const el = toastEl;
  toastEl = null;
  if (!el) return;
  el.removeAttribute('data-visible');
  toastRemoveTimer = setTimeout(() => el.remove(), 260);
}

export const Toast = {
  /**
   * @param {string} text
   * @param {{ ms?: number, action?: { label: string, onClick: () => void } }} [opts]
   */
  show(text, { ms = 2400, action } = {}) {
    clearTimeout(toastTimer);
    toastEl?.remove();
    const el = document.createElement('div');
    el.className = 'gl-ui gl-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    const label = document.createElement('span');
    label.textContent = text;
    el.appendChild(label);
    if (action) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gl-toast__action';
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        dismissToast();
        action.onClick();
      });
      el.appendChild(btn);
      el.dataset.interactive = 'true';
    }
    document.body.appendChild(el);
    toastEl = el;
    requestAnimationFrame(() => el.setAttribute('data-visible', 'true'));
    toastTimer = setTimeout(dismissToast, action ? Math.max(ms, 6000) : ms);
  },
  dismiss: dismissToast,
};

let pill = null;
let pillTimer = null;

function renderPill(iconName, text, state) {
  pill.dataset.state = state;
  pill.innerHTML = `<span class="gl-loading__icon">${icon(iconName, 16)}</span><span>${escapeHtml(text)}</span>`;
}

/** Persistent progress pill used while a PDF is generated. */
export const LoadingPill = {
  show(text) {
    clearTimeout(pillTimer);
    if (!pill) {
      pill = document.createElement('div');
      pill.className = 'gl-ui gl-loading';
      pill.setAttribute('role', 'status');
      pill.setAttribute('aria-live', 'polite');
      document.body.appendChild(pill);
      renderPill('spinner', text, 'loading');
      requestAnimationFrame(() => pill?.setAttribute('data-visible', 'true'));
    } else {
      renderPill('spinner', text, 'loading');
    }
  },

  update(text) {
    if (pill) renderPill('spinner', text, 'loading');
  },

  finish(success, text) {
    if (!pill) return;
    renderPill(success ? 'check' : 'close', text, success ? 'success' : 'error');
    clearTimeout(pillTimer);
    pillTimer = setTimeout(() => this.hide(), success ? 1400 : 2400);
  },

  hide() {
    clearTimeout(pillTimer);
    const el = pill;
    pill = null;
    if (!el) return;
    el.removeAttribute('data-visible');
    setTimeout(() => el.remove(), 260);
  },
};
