/**
 * Cancellable sequential job runner.
 *
 * Shared by everything that walks a list of things one at a time without
 * freezing the page (bulk export, bulk delete, index rebuild, prompt chains):
 *
 *   - items run strictly one after another (they drive Gemini's own UI),
 *   - the event loop is yielded between items so the page stays responsive,
 *   - a failing item is recorded and the batch continues,
 *   - a FatalJobError stops the batch (e.g. "this dialog is not the one I expect"),
 *   - cancel() takes effect before the next item and aborts the current one
 *     through the AbortSignal handed to the worker,
 *   - progress callbacks are cheap and synchronous.
 *
 * Pure: no DOM. Time functions are injectable for tests.
 */

export class FatalJobError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'FatalJobError';
  }
}

export class JobCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'JobCancelled';
  }
}

/** Let the browser paint / handle input. */
export function yieldToMain() {
  if (typeof globalThis.scheduler?.yield === 'function') return globalThis.scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new JobCancelled());
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new JobCancelled());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/**
 * @template T, R
 * @param {{
 *   items: T[],
 *   worker: (item: T, ctx: { index: number, signal: AbortSignal, attempt: number }) => Promise<R>,
 *   onProgress?: (p: { done: number, total: number, failed: number, index: number, item: T, state: 'start'|'ok'|'error' }) => void,
 *   retries?: number, retryDelayMs?: number,
 *   signal?: AbortSignal,
 *   yieldFn?: () => Promise<void>,
 * }} opts
 * @returns {Promise<{ results: ({ item: T, ok: true, value: R } | { item: T, ok: false, error: Error })[],
 *                     done: number, failed: number, cancelled: boolean, fatal: Error|null }>}
 */
export async function runJob({ items, worker, onProgress, retries = 0, retryDelayMs = 400, signal, yieldFn = yieldToMain }) {
  const total = items.length;
  const results = [];
  let failed = 0;
  let cancelled = false;
  let fatal = null;

  for (let index = 0; index < total; index++) {
    if (signal?.aborted) {
      cancelled = true;
      break;
    }
    const item = items[index];
    onProgress?.({ done: results.length, total, failed, index, item, state: 'start' });
    let outcome = null;
    for (let attempt = 0; attempt <= retries && !outcome; attempt++) {
      try {
        outcome = { item, ok: true, value: await worker(item, { index, signal, attempt }) };
      } catch (error) {
        if (error instanceof JobCancelled || signal?.aborted) {
          cancelled = true;
          break;
        }
        if (error instanceof FatalJobError) {
          fatal = error;
          outcome = { item, ok: false, error };
          break;
        }
        if (attempt === retries) outcome = { item, ok: false, error };
        else {
          try {
            await sleep(retryDelayMs * (attempt + 1), signal);
          } catch {
            cancelled = true;
            break;
          }
        }
      }
    }
    if (cancelled) break;
    results.push(outcome);
    if (!outcome.ok) failed++;
    onProgress?.({ done: results.length, total, failed, index, item, state: outcome.ok ? 'ok' : 'error' });
    if (fatal) break;
    await yieldFn();
  }
  return { results, done: results.length, failed, cancelled, fatal };
}

/** Split `list` into arrays of at most `size`. */
export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Poll until `predicate()` is truthy. Resolves true, or false on timeout; rejects
 * with JobCancelled on abort. Polling exists only while a job runs (never at idle).
 */
export async function waitUntil(predicate, { timeoutMs = 15000, intervalMs = 150, signal } = {}) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (signal?.aborted) throw new JobCancelled();
    if (predicate()) return true;
    if (Date.now() >= end) return false;
    await sleep(intervalMs, signal);
  }
}

/** `observe(sig)` returns true once `sig` has been identical `required` times in a row. */
export function createStabilityTracker(required = 3) {
  let last = null;
  let same = 0;
  return {
    observe(sig) {
      same = sig === last ? same + 1 : 1;
      last = sig;
      return same >= required;
    },
    reset() {
      last = null;
      same = 0;
    },
  };
}
