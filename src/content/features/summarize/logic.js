/**
 * Summarize and continue: the parts that need no page (pure / injectable).
 *
 *   summarizeChat     send the summary request, wait for the answer, read it
 *   continueInNewChat open a fresh chat and PRE-FILL (never send) the summary
 *   contextPercent / shouldSuggest   when to nudge the person
 */
import { SUMMARY_LIMITS } from '../../core/schema.js';

export class SummaryError extends Error {
  /** @param {'no-chat'|'navigated'|'empty-summary'} code */
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/** Share of the context window used, 0..100. */
export const contextPercent = (tokens, limit) => (limit > 0 ? Math.min(100, Math.max(0, (tokens / limit) * 100)) : 0);

/** Nudge once the context reaches the person's threshold (clamped to the allowed range). */
export function shouldSuggest(pct, hintAt = SUMMARY_LIMITS.hintDefault) {
  const at = Math.min(SUMMARY_LIMITS.hintMax, Math.max(SUMMARY_LIMITS.hintMin, Number.isFinite(hintAt) ? hintAt : SUMMARY_LIMITS.hintDefault));
  return pct >= at;
}

/** The person's own text, or the localized default when they left it empty. */
export const resolveText = (custom, fallback) => (String(custom ?? '').trim() ? String(custom).trim() : fallback);

/** What goes into the new chat: an intro line, then the summary. */
export function buildHandoff(intro, summary) {
  const body = String(summary ?? '').trim();
  const head = String(intro ?? '').trim();
  return head ? `${head}\n\n${body}` : body;
}

/**
 * @param {{ prompt: string, send: (text: string) => Promise<void>, getChatId: () => string|null,
 *           readSummary: () => string|Promise<string>, minChars?: number }} o
 * @returns {Promise<string>} the summary text
 */
export async function summarizeChat({ prompt, send, getChatId, readSummary, minChars = 20 }) {
  const startId = getChatId();
  if (!startId) throw new SummaryError('no-chat');
  await send(prompt); // throws ChainError-style errors with a `code`
  if (getChatId() !== startId) throw new SummaryError('navigated'); // the answer belongs to a chat we left
  const summary = String(await readSummary()).trim();
  if (summary.length < minChars) throw new SummaryError('empty-summary');
  return summary;
}

/**
 * @param {{ text: string, openFresh: () => Promise<boolean>, insert: (text: string) => boolean,
 *           persistHandoff: (text: string) => void, reload: () => void }} o
 * @returns {Promise<'inserted'|'reloading'|'failed'>}
 *   'reloading': the page had to be reloaded to reach a new chat; the text was stored and is
 *   inserted by consumeHandoff() once the new page is up.
 */
export async function continueInNewChat({ text, openFresh, insert, persistHandoff, reload }) {
  if (await openFresh()) return insert(text) ? 'inserted' : (persistHandoff(text), 'failed');
  persistHandoff(text);
  reload();
  return 'reloading';
}

/** A stored handoff that is still fresh, else null. Pure. */
export function freshHandoff(handoff, now = Date.now(), ttl = SUMMARY_LIMITS.handoffTtlMs) {
  return handoff && now - handoff.at >= 0 && now - handoff.at <= ttl ? handoff : null;
}
