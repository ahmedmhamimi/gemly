/**
 * Coalescing scan scheduler.
 *
 * Replaces the old trailing-edge debounce, which STARVED while Gemini was
 * streaming (mutations arrive faster than the debounce window, so it never
 * fired until the reply ended). This one:
 *   - runs at most once per `intervalMs()` (leading edge: no added latency
 *     after a quiet period, steady cadence under a mutation storm),
 *   - accumulates which page zones are dirty so only affected features run,
 *   - never runs while the tab is hidden (marks everything stale instead and
 *     catches up on return).
 */
export class Scheduler {
  /**
   * @param {{ run: (batch: {zones:Set<string>, all:boolean}) => void, intervalMs: () => number }} opts
   */
  constructor({ run, intervalMs }) {
    this._run = run;
    this._intervalMs = intervalMs;
    this._zones = new Set();
    this._all = false;
    this._timer = null;
    this._lastRun = 0;
    this._staleWhileHidden = false;
    this._disposed = false;
    this._onVisibility = () => {
      if (document.visibilityState === 'visible' && this._staleWhileHidden) {
        this._staleWhileHidden = false;
        this.markAll();
        this.request();
      }
    };
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  mark(zone) {
    this._zones.add(zone);
  }

  markAll() {
    this._all = true;
  }

  /** Ask for a scan soon (no-op if one is already scheduled). */
  request({ immediate = false } = {}) {
    if (this._disposed || this._timer !== null) return;
    const wait = immediate ? 0 : Math.max(0, this._intervalMs() - (performance.now() - this._lastRun));
    this._timer = setTimeout(() => {
      this._timer = null;
      this._flush();
    }, wait);
  }

  _flush() {
    if (this._disposed) return;
    if (document.visibilityState === 'hidden') {
      this._staleWhileHidden = true;
      return;
    }
    const batch = { zones: this._zones, all: this._all };
    this._zones = new Set();
    this._all = false;
    this._lastRun = performance.now();
    this._run(batch);
  }

  dispose() {
    this._disposed = true;
    clearTimeout(this._timer);
    this._timer = null;
    document.removeEventListener('visibilitychange', this._onVisibility);
  }
}
