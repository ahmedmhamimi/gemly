/**
 * Modal dialog: the one place that implements a blocking panel (bulk export,
 * settings, saved items…). One modal at a time.
 *
 *  - role="dialog" aria-modal, labelled by its title, focus moves in and is
 *    trapped, then restored to the opener on close
 *  - Escape and backdrop click close it (unless `dismissible: false`, used while
 *    a job is running so a stray click cannot hide a progress dialog)
 *  - keyboard events never leak to Gemini's global shortcuts
 *  - it does NOT close on SPA navigation: long jobs navigate on purpose
 *  - everything inside carries `.gl-ui`, so the mutation filter ignores it
 */
import { Lang } from '../i18n/index.js';
import { escapeHtml } from '../util/text.js';
import { icon } from './icons.js';

let active = null;

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Pure: index of the element to focus on Tab / Shift+Tab inside a trap (wraps). */
export function nextFocusIndex(count, current, backwards) {
  if (count <= 0) return -1;
  if (current < 0) return backwards ? count - 1 : 0;
  return (current + (backwards ? -1 : 1) + count) % count;
}

export const Modal = {
  current: () => active,

  /**
   * @param {{ title: string, content: HTMLElement, footer?: HTMLElement|null, width?: number,
   *           dismissible?: boolean, onClose?: () => void, id?: string }} opts
   */
  open({ title, content, footer = null, width = 560, dismissible = true, onClose, id }) {
    this.closeAll();
    const opener = document.activeElement;
    const titleId = `gl-modal-title-${Math.random().toString(36).slice(2, 8)}`;

    const backdrop = document.createElement('div');
    backdrop.className = 'gl-ui gl-modal-backdrop';
    backdrop.setAttribute('data-gemly-owned', '');
    const dialog = document.createElement('div');
    dialog.className = 'gl-modal';
    if (id) dialog.id = id;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', titleId);
    dialog.style.maxWidth = `min(${width}px, calc(100vw - 24px))`;
    dialog.tabIndex = -1;

    const head = document.createElement('div');
    head.className = 'gl-modal__head';
    head.innerHTML = `<h2 class="gl-modal__title" id="${titleId}" dir="auto">${escapeHtml(title)}</h2>`;
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'gl-icon-btn gl-modal__close';
    closeBtn.setAttribute('aria-label', Lang.t('modal.close'));
    closeBtn.dataset.glTip = Lang.t('modal.close');
    closeBtn.innerHTML = icon('close', 16);
    head.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'gl-modal__body gl-scroll';
    body.appendChild(content);
    dialog.append(head, body);
    let foot = null;
    if (footer) {
      foot = document.createElement('div');
      foot.className = 'gl-modal__foot';
      foot.appendChild(footer);
      dialog.appendChild(foot);
    }
    backdrop.appendChild(dialog);

    const state = { dismissible };
    const setDismissible = (v) => {
      state.dismissible = v;
      closeBtn.hidden = !v;
    };
    setDismissible(dismissible);

    let closed = false;
    const cleanups = [];
    const close = () => {
      if (closed) return;
      closed = true;
      cleanups.forEach((fn) => fn());
      backdrop.remove();
      if (active?.el === backdrop) active = null;
      if (opener?.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
      onClose?.();
    };
    const listen = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      cleanups.push(() => target.removeEventListener(type, fn, opts));
    };

    closeBtn.addEventListener('click', () => state.dismissible && close());
    listen(backdrop, 'mousedown', (e) => {
      if (e.target === backdrop && state.dismissible) close();
    });
    // Keep Gemini's shortcuts out while the dialog is open.
    for (const type of ['keydown', 'keyup', 'keypress']) listen(backdrop, type, (e) => e.stopPropagation());
    listen(document, 'keydown', (e) => {
      if (e.key === 'Escape' && state.dismissible) {
        e.stopPropagation();
        e.preventDefault();
        close();
      } else if (e.key === 'Tab') {
        const items = [...dialog.querySelectorAll(FOCUSABLE)].filter((n) => !n.hidden && n.offsetParent !== null);
        if (!items.length) return e.preventDefault();
        const i = nextFocusIndex(items.length, items.indexOf(document.activeElement), e.shiftKey);
        if (!dialog.contains(document.activeElement) || (e.shiftKey ? i === items.length - 1 : i === 0)) {
          e.preventDefault();
          items[i].focus();
        }
      }
    }, true);

    document.body.appendChild(backdrop);
    active = { el: backdrop, close, body, footer: foot, dialog, setDismissible, setTitle: (t) => (head.querySelector('.gl-modal__title').textContent = t) };
    (dialog.querySelector('[autofocus]') || dialog.querySelector(FOCUSABLE) || dialog).focus({ preventScroll: true });
    return active;
  },

  closeAll() {
    active?.close();
  },
};
