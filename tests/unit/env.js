// Minimal DOM + chrome.* environment for unit tests of modules that touch them.
import { JSDOM } from 'jsdom';

export function setupDom(html = '<!doctype html><html lang="en"><body></body></html>', url = 'https://gemini.google.com/app') {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true });
  const w = dom.window;
  for (const k of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'NodeFilter', 'MutationObserver', 'CustomEvent', 'Event', 'KeyboardEvent', 'DOMParser', 'HTMLTextAreaElement', 'HTMLInputElement', 'getComputedStyle', 'requestAnimationFrame', 'ResizeObserver']) {
    if (w[k] !== undefined) Object.defineProperty(globalThis, k, { value: w[k], configurable: true, writable: true });
  }
  Object.defineProperty(globalThis, 'location', { value: w.location, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true });
  globalThis.CSS = w.CSS || {};
  globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };
  return dom;
}

export function setupChrome() {
  const mem = {};
  const listeners = [];
  let failWith = null;
  globalThis.chrome = {
    runtime: { id: 'test' },
    storage: {
      local: {
        get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => k in mem).map((k) => [k, structuredClone(mem[k])])),
        set: async (o) => {
          if (failWith) throw new Error(failWith);
          const changes = {};
          for (const [k, v] of Object.entries(o)) {
            changes[k] = { oldValue: mem[k], newValue: structuredClone(v) };
            mem[k] = structuredClone(v);
          }
          mem.__writes = (mem.__writes || 0) + 1;
          listeners.forEach((l) => l(changes, 'local'));
        },
      },
      onChanged: { addListener: (l) => listeners.push(l), removeListener: (l) => listeners.splice(listeners.indexOf(l), 1) },
    },
  };
  return { mem, listeners, fail: (msg) => (failWith = msg) };
}
