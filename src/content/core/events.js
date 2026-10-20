/**
 * Tiny synchronous event bus used to decouple features from each other.
 *
 * Features never import one another to announce something ("an export just
 * happened", "the language changed"); they emit here and interested modules
 * subscribe. Adding a listener never requires editing the emitter.
 *
 * Events:
 *   navigate    { from, to }   SPA route changed
 *   locale      { locale }     page language changed
 *   theme       { mode }       light/dark changed
 *   store       { names }      persisted data changed (another tab)
 *   activity    { kind }       something valuable was done (review prompt)
 *   user-sent   {}             the person just sent a prompt
 *   generating  { on }         Gemini started/stopped streaming a reply
 */
export class Emitter {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._handlers = new Map();
  }

  /** @returns {() => void} unsubscribe */
  on(event, handler) {
    let set = this._handlers.get(event);
    if (!set) this._handlers.set(event, (set = new Set()));
    set.add(handler);
    return () => set.delete(handler);
  }

  emit(event, payload) {
    const set = this._handlers.get(event);
    if (!set) return;
    // Copy: a handler may unsubscribe itself while we iterate.
    for (const handler of [...set]) {
      try {
        handler(payload);
      } catch (err) {
        console.error('[Gemly][events]', `handler for "${event}" threw`, err);
      }
    }
  }

  clear() {
    this._handlers.clear();
  }
}

export const bus = new Emitter();
