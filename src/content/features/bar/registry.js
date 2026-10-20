/**
 * Bar widget registry. A feature that wants a control in the Gemly bar above
 * the prompt box registers a widget - the bar feature itself never changes.
 *
 * @typedef {Object} BarWidget
 * @property {string} id
 * @property {number} order            left-to-right position (lower first)
 * @property {(ctx: import('../../core/app.js').AppContext) => HTMLElement} build  create the element (once per mount)
 * @property {(el: HTMLElement, scan: import('../../core/app.js').ScanContext, ctx: import('../../core/app.js').AppContext) => void} [update] refresh on scan
 * @property {() => void} [teardown]
 */
import { Features } from '../../core/feature-registry.js';

/** @type {BarWidget[]} */
const widgets = [];
let cache = { version: -1, size: -1, list: [] };

export function registerBarWidget(widget) {
  if (widgets.some((w) => w.id === widget.id)) throw new Error(`Duplicate bar widget "${widget.id}"`);
  widgets.push(widget);
  widgets.sort((a, b) => a.order - b.order);
}

/** Widgets whose owning feature is on (memoised: the bar asks on every scan). */
export function barWidgets() {
  if (cache.version !== Features.version || cache.size !== widgets.length) {
    cache = { version: Features.version, size: widgets.length, list: Features.filterFacets('widget', widgets) };
  }
  return cache.list;
}

/** Every registered id, on or off (manifest test). */
export const registeredBarWidgetIds = () => widgets.map((w) => w.id);
