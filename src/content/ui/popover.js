/**
 * The one popover/menu manager. Every floating panel in Gemly (download menu,
 * tone picker, prompt library, folder menus, bookmarks list) goes through here
 * so positioning, dismissal and accessibility are implemented - and fixed -
 * exactly once:
 *
 *  - single open popover at a time
 *  - flips above/below and clamps inside the viewport; re-positions on
 *    window resize / any scroll / content growth (RTL-aware)
 *  - closes on outside press, Escape, navigation, or when its anchor is
 *    removed from the page
 *  - aria-expanded on the anchor, arrow-key navigation for role="menu"
 *  - focus returns to the anchor if it was inside the popover
 */
import { bus } from '../core/events.js';
import { clamp, isRtl, rafThrottle } from '../util/dom.js';

const MARGIN = 8;
const GAP = 10;

/**
 * Pure placement maths (unit-tested).
 * @param {DOMRect|{top:number,bottom:number,left:number,right:number}} a anchor rect
 * @param {{width:number,height:number}} p popover size
 * @param {{width:number,height:number}} vp viewport size
 * @param {{placement?:'auto'|'top'|'bottom', align?:'start'|'end', rtl?:boolean}} opts
 */
export function computePosition(a, p, vp, { placement = 'auto', align = 'start', rtl = false } = {}) {
  const spaceAbove = a.top - MARGIN;
  const spaceBelow = vp.height - a.bottom - MARGIN;
  let side = placement;
  if (side === 'auto') {
    if (spaceAbove >= p.height + GAP) side = 'top';
    else if (spaceBelow >= p.height + GAP) side = 'bottom';
    else side = spaceAbove > spaceBelow ? 'top' : 'bottom';
  }
  let top = side === 'top' ? a.top - p.height - GAP : a.bottom + GAP;
  top = clamp(top, MARGIN, Math.max(MARGIN, vp.height - p.height - MARGIN));

  // 'start' hugs the anchor's leading edge, 'end' its trailing edge.
  const hugLeft = (align === 'start') !== rtl;
  let left = hugLeft ? a.left : a.right - p.width;
  left = clamp(left, MARGIN, Math.max(MARGIN, vp.width - p.width - MARGIN));
  return { top, left, side };
}

let active = null;

export const Popover = {
  current: () => active,

  /**
   * @param {{
   *   anchor: HTMLElement, content: HTMLElement,
   *   placement?: 'auto'|'top'|'bottom', align?: 'start'|'end',
   *   role?: 'menu'|'dialog', onClose?: () => void,
   * }} opts
   */
  open({ anchor, content, placement = 'auto', align = 'start', role = 'dialog', onClose }) {
    this.closeAll();
    const cleanups = [];
    const listen = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      cleanups.push(() => target.removeEventListener(type, fn, opts));
    };

    content.setAttribute('role', role);
    content.dataset.glPopover = '';
    content.style.maxHeight = `calc(100vh - ${MARGIN * 2}px)`;
    document.body.appendChild(content);
    anchor.setAttribute('aria-haspopup', role);
    anchor.setAttribute('aria-expanded', 'true');
    anchor.dataset.open = 'true';

    const reposition = () => {
      if (!anchor.isConnected) return close();
      const pos = computePosition(
        anchor.getBoundingClientRect(),
        { width: content.offsetWidth, height: content.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        { placement, align, rtl: isRtl() },
      );
      content.style.top = `${pos.top}px`;
      content.style.left = `${pos.left}px`;
      content.style.transformOrigin = `${align === 'end' ? 'right' : 'left'} ${pos.side === 'top' ? 'bottom' : 'top'}`;
    };
    const scheduled = rafThrottle(reposition);

    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      const hadFocus = content.contains(document.activeElement);
      cleanups.forEach((fn) => fn());
      content.remove();
      anchor.setAttribute('aria-expanded', 'false');
      delete anchor.dataset.open;
      if (active?.el === content) active = null;
      if (hadFocus && anchor.isConnected) anchor.focus({ preventScroll: true });
      onClose?.();
    }

    listen(document, 'pointerdown', (e) => {
      if (!content.contains(e.target) && !anchor.contains(e.target)) close();
    }, true);
    listen(document, 'keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      } else if (role === 'menu' && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End')) {
        const items = [...content.querySelectorAll('[role="menuitem"], .gl-menu-item')].filter((n) => !n.disabled);
        if (!items.length) return;
        e.preventDefault();
        const i = items.indexOf(document.activeElement);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
          : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next].focus();
      }
    }, true);
    listen(window, 'resize', scheduled);
    listen(window, 'scroll', scheduled, true);
    const ro = new ResizeObserver(scheduled);
    ro.observe(content);
    cleanups.push(() => ro.disconnect());
    cleanups.push(bus.on('navigate', close));

    reposition();
    if (role === 'menu') {
      content.tabIndex = -1;
      content.focus({ preventScroll: true });
    }

    active = { el: content, anchor, close, reposition };
    return active;
  },

  closeAll() {
    active?.close();
  },
};
