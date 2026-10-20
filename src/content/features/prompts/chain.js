/**
 * Prompt chains: send step 1, wait for the answer, send step 2, and so on.
 *
 * `runChain` is the sequencer (stop button, progress, stop-on-failure) and takes
 * an injected `send`; `sendAndWait` is the page-facing implementation, with its
 * dependencies injectable so the whole thing is testable with a fake page.
 *
 * Any failure stops the chain: step N+1 is written for the answer to step N, so
 * pressing on after a failed step would only produce nonsense.
 */
import { createStabilityTracker, FatalJobError, JobCancelled, runJob, sleep, waitUntil } from '../../core/jobs.js';

export class ChainError extends Error {
  /** @param {'no-editor'|'composer-busy'|'send-failed'|'timeout'} code */
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export const CHAIN_TIMING = Object.freeze({ busyMs: 4000, canSendMs: 3000, startMs: 12000, doneMs: 10 * 60 * 1000, intervalMs: 150, settleMs: 120, betweenMs: 600 });

/**
 * @param {{ steps: string[], send: (text: string, ctx: { index: number, signal: AbortSignal }) => Promise<void>,
 *           signal?: AbortSignal, onStep?: (p: { index: number, total: number, state: 'start'|'done'|'error' }) => void,
 *           pauseMs?: number }} o
 * @returns {Promise<{ completed: number, total: number, cancelled: boolean, error: string|null }>}
 */
export async function runChain({ steps, send, signal, onStep, pauseMs = CHAIN_TIMING.betweenMs }) {
  const total = steps.length;
  const res = await runJob({
    items: steps.map((text, index) => ({ text, index })),
    signal,
    retries: 0,
    yieldFn: () => sleep(pauseMs, signal).catch(() => {}),
    worker: async (item, { signal: s }) => {
      try {
        await send(item.text, { index: item.index, signal: s });
      } catch (err) {
        if (err instanceof JobCancelled) throw err;
        throw new FatalJobError(err?.code || 'send-failed', { cause: err }); // any failed step ends the chain
      }
    },
    onProgress: ({ item, state }) => onStep?.({ index: item.index, total, state: state === 'start' ? 'start' : state === 'ok' ? 'done' : 'error' }),
  });
  return { completed: res.results.filter((r) => r.ok).length, total, cancelled: res.cancelled, error: res.fatal ? res.fatal.cause?.code || res.fatal.message : null };
}

/**
 * Put `text` in the prompt box, send it, and resolve when Gemini has finished answering.
 * @param {string} text
 * @param {{ signal?: AbortSignal, host: object, insert: (editor: any, text: string, o: object) => boolean, timing?: typeof CHAIN_TIMING }} o
 */
export async function sendAndWait(text, { signal, host, insert, timing = CHAIN_TIMING }) {
  const wait = (pred, ms) => waitUntil(pred, { timeoutMs: ms, intervalMs: timing.intervalMs, signal });

  const editor = host.editor();
  if (!editor) throw new ChainError('no-editor');
  // The previous answer must be done and the box empty, or the new text would be appended to a draft.
  if (!(await wait(() => !host.isGenerating() && !host.editorText(editor).trim(), timing.busyMs))) throw new ChainError('composer-busy');
  if (!insert(editor, text, { atEnd: true })) throw new ChainError('no-editor');
  await sleep(timing.settleMs, signal);

  if (!(await wait(() => host.canSend(host.sendButton()), timing.canSendMs))) throw new ChainError('send-failed');
  const turnsBefore = host.turns().length;
  host.sendButton().click();

  // Wait for the reply to START (or at least a new turn to appear), then for it to FINISH.
  if (!(await wait(() => host.isGenerating() || host.turns().length > turnsBefore, timing.startMs))) throw new ChainError('send-failed');
  const tracker = createStabilityTracker(3);
  const idle = () => tracker.observe(host.isGenerating() ? `busy${Math.random()}` : 'idle');
  if (!(await wait(idle, timing.doneMs))) throw new ChainError('timeout');
}

/**
 * The `send` for runChain, with a navigation guard: if the person opens a different
 * chat mid-chain, the next step is NOT sent (it would land in the wrong conversation).
 * A chain that starts on the empty "new chat" page is allowed to move to the chat id
 * Gemini assigns after step 1.
 */
export function makeChainSender({ host, insert, timing }) {
  let expected = null;
  let started = false;
  return async (text, ctx) => {
    if (started) {
      const now = host.currentConversationId();
      // A chat that was still unsaved after step 1 gets its id a moment later: adopt it once.
      if (expected === null && now) expected = now;
      else if (expected !== null && now !== expected) throw new ChainError('navigated');
    }
    await sendAndWait(text, { ...ctx, host, insert, timing });
    if (!started) {
      expected = host.currentConversationId();
      started = true;
    }
  };
}
