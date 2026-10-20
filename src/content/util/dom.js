import { OWN } from '../core/config.js';

/**
 * Trusted Types safety net.
 *
 * Google properties may enforce `require-trusted-types-for 'script'`. Content
 * scripts normally run exempt in their isolated world, but if a Chrome build
 * ever applies it, a plain `el.innerHTML = '<svg…'` throws and would take the
 * whole UI down. When the browser lets us register a pass-through policy we
 * route innerHTML through it; otherwise this is a silent no-op. Only strings
 * Gemly builds itself (escapeHtml() on anything from the page) reach it.
 */
export function installTrustedTypesShim() {
  try {
    const tt = globalThis.trustedTypes;
    if (!tt || typeof tt.createPolicy !== 'function') return;
    const policy = tt.createPolicy('gemly-ui', { createHTML: (s) => s });
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    if (!desc || !desc.set) return;
    Object.defineProperty(Element.prototype, 'innerHTML', {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set(value) {
        desc.set.call(this, typeof value === 'string' ? policy.createHTML(value) : value);
      },
    });
  } catch {
    /* policy name not allowed by the page - nothing to do */
  }
}

/** Closest-ancestor-or-self lookup that tolerates text nodes / null. */
function asElement(node) {
  if (!node) return null;
  return node.nodeType === 1 ? node : node.parentElement;
}

/** True if `node` is (inside) DOM that Gemly created. */
export function isOwn(node) {
  const el = asElement(node);
  return !!(el && typeof el.closest === 'function' && el.closest(OWN.selector));
}

/**
 * True if a mutation record was caused purely by Gemly's own DOM work, so it
 * must not trigger another scan (which would re-inject and loop).
 */
export function isOwnMutation(record) {
  if (isOwn(record.target)) return true;
  if (record.type !== 'childList') return false;
  const nodes = [...record.addedNodes, ...record.removedNodes];
  if (!nodes.length) return false;
  return nodes.every((n) => (n.nodeType === 3 && !n.textContent.trim()) || isOwn(n));
}

/** First element matching any selector in the ordered fallback list. */
export function queryFirst(selectors, root = document) {
  for (const sel of Array.isArray(selectors) ? selectors : [selectors]) {
    try {
      const el = root.querySelector(sel);
      if (el) return el;
    } catch {
      /* selector unsupported in this browser - try the next one */
    }
  }
  return null;
}

/** Elements for the first selector in the list that matches anything. */
export function queryAllFirst(selectors, root = document) {
  for (const sel of Array.isArray(selectors) ? selectors : [selectors]) {
    try {
      const found = root.querySelectorAll(sel);
      if (found.length) return Array.from(found);
    } catch {
      /* ignore */
    }
  }
  return [];
}

/** Rendered text when available, DOM text otherwise (e.g. detached/hidden). */
export function visibleText(el) {
  if (!el) return '';
  const rendered = typeof el.innerText === 'string' ? el.innerText : '';
  return (rendered !== '' ? rendered : el.textContent || '').replace(/\u200b/g, '').trim();
}

export const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

export function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

export function isRtl() {
  return document.documentElement.getAttribute('data-gl-dir') === 'rtl';
}

/** Create an element with class/attrs/text in one call. */
export function h(tag, { cls, attrs, text, html, children } = {}) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  if (text != null) el.textContent = text;
  if (html != null) el.innerHTML = html;
  if (children) el.append(...children);
  return el;
}

/** Call `fn` at most once per animation frame. */
export function rafThrottle(fn) {
  let queued = false;
  return (...args) => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn(...args);
    });
  };
}
