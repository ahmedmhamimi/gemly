/**
 * One shared tooltip for every control with a `data-gl-tip` attribute,
 * replacing the browser's slow, unstyled `title`.
 *
 * A tooltip stays for as long as the pointer is on its control (or the control has
 * keyboard focus). It is dismissed only when that stops being true, when the control is
 * removed, or when the person clicks elsewhere. Scrolling moves it along instead of
 * hiding it.
 *
 * `data-gl-tip-keep` (used by the little "i" help icons) also keeps it open on click and
 * lets a tap open it on touch screens, where hover does not exist.
 *
 * Resource-friendly by construction: only the permanent listeners below exist while idle;
 * the mutation observer and the safety poll exist ONLY while a tooltip is showing.
 */
const SHOW_DELAY_MS = 350;
const POLL_MS = 300;
const GAP = 9;
const MARGIN = 8;

export function createTooltip() {
  let el = null;
  let target = null;
  let showTimer = null;
  let live = null; // cleanup for listeners that exist only while visible
  let viaPointer = true; // true: shown by hovering, so "still hovered" decides; false: focus / tap
  let raf = 0;

  const find = (node) => node?.closest?.('[data-gl-tip]') || null;
  const keeps = (node) => !!find(node)?.hasAttribute('data-gl-tip-keep');
  const hovered = (node) => {
    try {
      return node.matches(':hover');
    } catch {
      return true;
    }
  };

  function position() {
    if (!el || !target) return;
    const r = target.getBoundingClientRect();
    const t = el.getBoundingClientRect();
    let top = r.top - t.height - GAP;
    let placement = 'top';
    if (top < MARGIN) {
      top = r.bottom + GAP;
      placement = 'bottom';
    }
    const left = Math.max(MARGIN, Math.min(r.left + r.width / 2 - t.width / 2, window.innerWidth - t.width - MARGIN));
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
    el.dataset.placement = placement;
  }

  function hide() {
    clearTimeout(showTimer);
    cancelAnimationFrame(raf);
    showTimer = null;
    target = null;
    el?.classList.remove('gl-tooltip--visible');
    live?.();
    live = null;
  }

  function show(node, { pointer = true } = {}) {
    const text = node.getAttribute('data-gl-tip');
    if (!text) return;
    clearTimeout(showTimer);
    target = node;
    viaPointer = pointer;
    if (!el) {
      el = document.createElement('div');
      el.className = 'gl-ui gl-tooltip';
      el.setAttribute('role', 'tooltip');
      el.dir = 'auto';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('gl-tooltip--visible');
    requestAnimationFrame(() => target === node && position());

    // Safety net only while visible: the control can be re-rendered away or covered without
    // pointerout ever firing. It asks the browser whether the control is STILL hovered
    // (never a remembered mouse position, which goes stale between tooltips).
    live?.();
    const mo = new MutationObserver(() => {
      if (target && !target.isConnected) hide();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    const poll = setInterval(() => {
      if (!target || !target.isConnected) return hide();
      const r = target.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return hide();
      if (viaPointer && !hovered(target)) hide();
    }, POLL_MS);
    live = () => {
      mo.disconnect();
      clearInterval(poll);
    };
  }

  const onOver = (e) => {
    if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    const t = find(e.target);
    if (!t || t === target) return;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => show(t), SHOW_DELAY_MS);
  };
  const onOut = (e) => {
    const t = find(e.target);
    if (!t) return;
    if (e.relatedTarget && t.contains(e.relatedTarget)) return;
    if (t === target || showTimer) hide();
  };
  const onFocusIn = (e) => {
    const t = find(e.target);
    if (t && e.target.matches?.(':focus-visible')) show(t, { pointer: false });
  };
  const onFocusOut = (e) => {
    if (find(e.target) === target) hide();
  };
  // A press elsewhere dismisses; a press on a "keep" control does not.
  const onDown = (e) => {
    if (!keeps(e.target)) hide();
  };
  // Click on a "keep" control: show at once (quick click, or a tap); a second tap closes it.
  const onClick = (e) => {
    const t = find(e.target);
    if (!t || !t.hasAttribute('data-gl-tip-keep')) return;
    const mouse = e.pointerType === 'mouse' || e.pointerType === 'pen';
    if (t === target) {
      if (!mouse && e.pointerType) hide();
      return;
    }
    show(t, { pointer: mouse });
  };
  // Follow the control while something scrolls; the poll dismisses it once it is no longer hovered.
  const onScroll = () => {
    if (!target || raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      position();
    });
  };

  document.addEventListener('pointerover', onOver);
  document.addEventListener('pointerout', onOut);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('click', onClick, true);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', hide);

  return function dispose() {
    hide();
    document.removeEventListener('pointerover', onOver);
    document.removeEventListener('pointerout', onOut);
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('focusout', onFocusOut, true);
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('click', onClick, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', hide);
    el?.remove();
    el = null;
  };
}
