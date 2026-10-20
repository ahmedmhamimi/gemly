/**
 * Placement of Gemly's blocks in Gemini's sidebar (chat filter, folders, …).
 *
 * Blocks are inserted directly above Gemini's chat list, ordered by their
 * `order`, and hidden automatically while the sidebar is collapsed to its
 * narrow icon rail (a ResizeObserver - class/width changes there do not
 * necessarily mutate the DOM, so mutation-driven scans would miss them).
 */
import { GeminiHost as host } from '../../host/gemini.js';

const MIN_WIDTH = 190;
const ORDER_ATTR = 'data-gl-sidebar-order';

let observer = null;
let observed = null;

/**
 * Width of the sidebar as the person sees it. Gemini's inner wrappers are
 * custom elements that may be `display: inline` (clientWidth 0), so measure
 * the sidebar container, falling back to the block's parent.
 */
function sidebarWidth(parent) {
  const el = host.sidebar() || parent;
  const w = el.getBoundingClientRect().width;
  return w || parent.getBoundingClientRect().width;
}

function applyWidth(parent) {
  const w = sidebarWidth(parent);
  const narrow = w > 0 && w < MIN_WIDTH;
  parent.querySelectorAll(`:scope > [${ORDER_ATTR}]`).forEach((el) => {
    if (el.hidden !== narrow) el.hidden = narrow;
  });
}

/** Insert/refresh `el` in the sidebar. Returns false if the sidebar isn't there (yet). */
export function mountSidebarBlock(el, order) {
  const anchor = host.sidebarAnchor();
  const parent = anchor?.parentElement;
  if (!parent) return false;
  if (el.parentElement === parent && el.isConnected) return true;

  el.setAttribute(ORDER_ATTR, String(order));
  const siblings = [...parent.querySelectorAll(`:scope > [${ORDER_ATTR}]`)];
  const next = siblings.find((s) => Number(s.getAttribute(ORDER_ATTR)) > order);
  parent.insertBefore(el, next || anchor);

  if (observed !== parent) {
    observer?.disconnect();
    observer = new ResizeObserver(() => applyWidth(parent));
    observer.observe(parent);
    const sidebar = host.sidebar();
    if (sidebar && sidebar !== parent) observer.observe(sidebar);
    observed = parent;
  }
  applyWidth(parent);
  return true;
}

export function unmountSidebarBlocks() {
  observer?.disconnect();
  observer = observed = null;
}
