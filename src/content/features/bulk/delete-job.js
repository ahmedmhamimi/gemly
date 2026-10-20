/**
 * Delete chats through Gemini's OWN menu, exactly like a person would:
 * row "..." button -> Delete -> confirm. There is no private endpoint.
 *
 * Failure policy (a wrong click here is destructive, so it is conservative):
 *   - per-chat problems ('not-in-sidebar', 'still-present') are recorded and the
 *     batch continues;
 *   - anything that means "Gemini's UI is not what we expect" ('no-menu-button',
 *     'no-delete-item', 'no-confirm') STOPS the batch (FatalJobError) after closing
 *     whatever is open, because every later chat would fail the same way, or worse;
 *   - a chat counts as deleted only when it has really disappeared from the sidebar.
 *
 * `host` is injectable so the whole state machine is testable without Gemini.
 */
import { FatalJobError, JobCancelled, runJob, sleep, waitUntil } from '../../core/jobs.js';
import { GeminiHost } from '../../host/gemini.js';

export const DELETE_TIMING = Object.freeze({ stepMs: 3000, goneMs: 8000, intervalMs: 100, betweenMs: 450 });

export class DeleteError extends Error {
  /** @param {'not-in-sidebar'|'still-present'|'no-menu-button'|'no-delete-item'|'no-confirm'} code */
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const fatal = (code) => new FatalJobError(code, { cause: new DeleteError(code) });

/**
 * @param {{ id: string, title: string }[]} items
 * @returns {Promise<{ deleted: string[], failures: { id: string, title: string, code: string }[], cancelled: boolean, fatal: string|null }>}
 */
export async function deleteChats(items, { signal, onProgress, host = GeminiHost, timing = DELETE_TIMING } = {}) {
  const wait = (pred, ms) => waitUntil(pred, { timeoutMs: ms, intervalMs: timing.intervalMs, signal });

  const res = await runJob({
    items,
    signal,
    retries: 0, // never retry a destructive step
    yieldFn: () => sleep(timing.betweenMs, signal).catch(() => {}),
    worker: async (item) => {
      const link = host.linkFor(item.id);
      if (!link) throw new DeleteError('not-in-sidebar');

      const menuBtn = host.chatMenuButton(link);
      if (!menuBtn) throw fatal('no-menu-button');
      menuBtn.click();

      if (!(await wait(() => host.deleteMenuItem(), timing.stepMs))) {
        host.closeOverlays();
        throw fatal('no-delete-item');
      }
      host.deleteMenuItem().click();

      if (!(await wait(() => host.confirmDeleteButton(), timing.stepMs))) {
        host.closeOverlays();
        throw fatal('no-confirm');
      }
      host.confirmDeleteButton().click();

      if (!(await wait(() => host.isChatGone(item.id), timing.goneMs))) throw new DeleteError('still-present');
    },
    onProgress,
  });

  // A cancel can land while a menu or dialog is open; never leave one behind.
  if (res.cancelled) host.closeOverlays();

  const deleted = res.results.filter((r) => r.ok).map((r) => r.item.id);
  const failures = res.results
    .filter((r) => !r.ok)
    .map((r) => ({ id: r.item.id, title: r.item.title, code: r.error.cause?.code || r.error.code || 'unknown' }));
  return { deleted, failures, cancelled: res.cancelled, fatal: res.fatal ? res.fatal.cause?.code || 'unknown' : null };
}

export { JobCancelled };
