import { Lang } from '../i18n/index.js';
import { icon } from './icons.js';

/**
 * Briefly swap an icon button to a success/failure state, then restore it
 * exactly. Safe to call repeatedly (a pending restore is replaced).
 */
export function flashButton(btn, ok, failTip) {
  if (!btn || !btn.isConnected) return;
  clearTimeout(btn._glFlash);
  if (btn._glOriginal === undefined) btn._glOriginal = { html: btn.innerHTML, tip: btn.dataset.glTip };
  btn.innerHTML = icon(ok ? 'check' : 'close', 17);
  btn.dataset.state = ok ? 'ok' : 'err';
  btn.dataset.glTip = ok ? Lang.t('toolbar.copy.copied') : failTip || Lang.t('toolbar.copy.failed');
  btn._glFlash = setTimeout(() => {
    const o = btn._glOriginal;
    btn._glOriginal = undefined;
    if (!o) return;
    btn.innerHTML = o.html;
    if (o.tip === undefined) delete btn.dataset.glTip;
    else btn.dataset.glTip = o.tip;
    delete btn.dataset.state;
  }, 1300);
}

/** Standard icon button factory. */
export function iconButton({ id, iconName, tip, size = 17, cls = '' }) {
  const btn = document.createElement('button');
  if (id) btn.id = id;
  btn.type = 'button';
  btn.className = `gl-ui gl-icon-btn ${cls}`.trim();
  btn.setAttribute('aria-label', tip);
  btn.dataset.glTip = tip;
  btn.innerHTML = icon(iconName, size);
  return btn;
}
