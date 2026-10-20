/**
 * Selection state for bulk chat management. In memory only (a selection never
 * outlives the page), observable, and free of any DOM so it is unit-testable.
 */

/** Pure: ids between `a` and `b` inclusive, in list order (shift-click range). Unknown ends -> just `b`. */
export function rangeBetween(order, a, b) {
  const i = order.indexOf(a);
  const j = order.indexOf(b);
  if (j < 0) return [];
  if (i < 0) return [b];
  const [lo, hi] = i < j ? [i, j] : [j, i];
  return order.slice(lo, hi + 1);
}

class SelectionState {
  constructor() {
    this._on = false;
    this._ids = new Set();
    this._anchor = null;
    this._showArchived = false;
    this._subs = new Set();
  }

  subscribe(fn) {
    this._subs.add(fn);
    return () => this._subs.delete(fn);
  }

  _emit() {
    for (const fn of [...this._subs]) {
      try {
        fn();
      } catch {
        /* a broken subscriber must not break selection */
      }
    }
  }

  get on() {
    return this._on;
  }

  setOn(v) {
    v = !!v;
    if (v === this._on) return;
    this._on = v;
    if (!v) {
      this._ids.clear();
      this._anchor = null;
    }
    this._emit();
  }

  get size() {
    return this._ids.size;
  }

  has(id) {
    return this._ids.has(id);
  }

  ids() {
    return [...this._ids];
  }

  toggle(id) {
    if (this._ids.has(id)) this._ids.delete(id);
    else this._ids.add(id);
    this._anchor = id;
    this._emit();
  }

  /** Select (or deselect) the range from the last toggled chat to `id`, following `order`. */
  toggleRange(id, order) {
    const range = rangeBetween(order, this._anchor, id);
    const turnOn = !this._ids.has(id);
    for (const r of range) {
      if (turnOn) this._ids.add(r);
      else this._ids.delete(r);
    }
    this._anchor = id;
    this._emit();
  }

  set(ids) {
    this._ids = new Set(ids);
    this._emit();
  }

  clear() {
    if (!this._ids.size) return;
    this._ids.clear();
    this._emit();
  }

  /** Drop ids that are no longer selectable (deleted, archived and hidden). */
  remove(ids) {
    let changed = false;
    for (const id of ids) changed = this._ids.delete(id) || changed;
    if (changed) this._emit();
  }

  get showArchived() {
    return this._showArchived;
  }

  setShowArchived(v) {
    this._showArchived = !!v;
    this._emit();
  }
}

export const Selection = new SelectionState();
export { SelectionState };
