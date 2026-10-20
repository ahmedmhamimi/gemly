/**
 * The Gemly bar: a slim glass strip above Gemini's prompt box that hosts every
 * registered BarWidget. Injected as ONE self-contained element in front of the
 * composer, so it never depends on the internals of Gemini's input toolbar.
 */
import { IDS } from '../../core/config.js';
import { BRAND_NAME } from '../../core/config.js';
import { barWidgets } from './registry.js';

/** @type {import('../../core/app.js').Feature} */
export const barFeature = (() => {
  /** @type {Map<string, HTMLElement>} */
  let built = new Map();
  let resizeObserver = null;

  /**
   * Keep the bar inside the space it is given: below ~560px drop the text
   * labels, below ~360px keep only the icon buttons.
   */
  function applyDensity(bar) {
    const w = bar.parentElement?.getBoundingClientRect().width || window.innerWidth;
    const density = w < 360 ? 'tiny' : w < 560 ? 'compact' : 'full';
    if (bar.dataset.density !== density) bar.dataset.density = density;
  }

  const isMounted = () => {
    const bar = document.getElementById(IDS.bar);
    return !!bar?.isConnected;
  };

  function mount(ctx) {
    const root = ctx.host.composerRoot();
    if (!root?.parentElement) return false;
    const bar = document.createElement('div');
    bar.id = IDS.bar;
    bar.className = 'gl-ui gl-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', BRAND_NAME);
    built = new Map();
    for (const w of barWidgets()) {
      const el = w.build(ctx);
      built.set(w.id, el);
      bar.appendChild(el);
    }
    root.insertAdjacentElement('beforebegin', bar);
    resizeObserver?.disconnect();
    resizeObserver = new ResizeObserver(() => applyDensity(bar));
    resizeObserver.observe(bar.parentElement);
    applyDensity(bar);
    return true;
  }

  return {
    id: 'bar',
    zones: ['composer', 'chat'],
    scan(scan, ctx) {
      if (!isMounted() && !mount(ctx)) return;
      for (const w of barWidgets()) {
        const el = built.get(w.id);
        if (el && w.update) w.update(el, scan, ctx);
      }
    },
    teardown() {
      document.getElementById(IDS.bar)?.remove();
      for (const w of barWidgets()) w.teardown?.();
      resizeObserver?.disconnect();
      resizeObserver = null;
      built = new Map();
    },
  };
})();
