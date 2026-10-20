/**
 * Namespaced logger.
 *
 * Quiet by default (warn/error only). Turn on verbose tracing from the
 * extension's DevTools context with:
 *   chrome.storage.local.set({ 'gemly-debug': true })
 * then reload the Gemini tab.
 */

const PREFIX = '[Gemly]';
let verbose = false;
const warned = new Set();

export function setVerbose(on) {
  verbose = !!on;
}

export function isVerbose() {
  return verbose;
}

/**
 * @param {string} scope e.g. 'store', 'feature:folders'
 */
export function createLogger(scope) {
  const tag = `${PREFIX}[${scope}]`;
  return {
    debug: (...a) => verbose && console.debug(tag, ...a),
    info: (...a) => verbose && console.info(tag, ...a),
    warn: (...a) => console.warn(tag, ...a),
    error: (...a) => console.error(tag, ...a),
    /** Warn at most once per key - for conditions checked on every scan. */
    warnOnce(key, ...a) {
      const k = `${scope}:${key}`;
      if (warned.has(k)) return;
      warned.add(k);
      console.warn(tag, ...a);
    },
  };
}
