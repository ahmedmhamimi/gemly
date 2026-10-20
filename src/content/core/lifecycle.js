/**
 * Extension-context lifecycle.
 *
 * When the extension is reloaded/updated, content scripts already running in
 * open tabs are orphaned: `chrome.*` starts throwing "Extension context
 * invalidated", yet their DOM and listeners remain. A newer instance may
 * also be injected into the same page. This module:
 *   - tells the app whether the context is still alive,
 *   - lets a new instance evict an old one (and sweep its leftover DOM),
 *   - provides a Disposables bag so shutdown is complete and symmetrical.
 */
import { OWN } from './config.js';

export const INSTANCE_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const SHUTDOWN_EVENT = 'gemly:shutdown';

export function isContextAlive() {
  try {
    return !!(globalThis.chrome && chrome.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

/** Ask any older instance in this page to tear itself down. */
export function evictPreviousInstances() {
  document.dispatchEvent(new CustomEvent(SHUTDOWN_EVENT, { detail: { by: INSTANCE_ID } }));
}

/** Call `onShutdown` if a newer instance asks this one to leave. */
export function onEvicted(onShutdown) {
  const handler = (e) => {
    if (e.detail?.by !== INSTANCE_ID) onShutdown();
  };
  document.addEventListener(SHUTDOWN_EVENT, handler);
  return () => document.removeEventListener(SHUTDOWN_EVENT, handler);
}

/** Remove DOM, classes and attributes left behind by a previous instance. */
export function sweepOrphans(root = document) {
  root.querySelectorAll(OWN.selector).forEach((el) => el.remove());
  root.querySelectorAll('.gl-hidden').forEach((el) => el.classList.remove('gl-hidden'));
  root.querySelectorAll('.gl-dragging-source, .gl-flash-target').forEach((el) => {
    el.classList.remove('gl-dragging-source', 'gl-flash-target');
  });
  ['data-gemly-row', 'data-gemly-bm-host'].forEach((attr) => {
    root.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr));
  });
  CSS.highlights?.delete?.('gemly-search');
  CSS.highlights?.delete?.('gemly-search-active');
  document.documentElement.removeAttribute('data-gl-theme');
  document.documentElement.removeAttribute('data-gl-dir');
}

/** A bag of cleanup callbacks, run in reverse order exactly once. */
export class Disposables {
  constructor() {
    this._fns = [];
  }

  add(fn) {
    this._fns.push(fn);
    return fn;
  }

  /** addEventListener that is removed automatically on dispose. */
  listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this.add(() => target.removeEventListener(type, handler, options));
  }

  dispose() {
    const fns = this._fns.reverse();
    this._fns = [];
    for (const fn of fns) {
      try {
        fn();
      } catch (err) {
        console.warn('[Gemly] cleanup failed', err);
      }
    }
  }
}
