/**
 * Reach an empty "new chat" page through Gemini's own navigation. Shared by
 * personas and summarize-and-continue.
 */
import { sleep, waitUntil } from '../core/jobs.js';

/** An empty new-chat page: no chat id yet and nothing rendered. */
export const isFreshChat = (host) => !host.currentConversationId() && host.turns().length === 0;

/** @returns {Promise<boolean>} true when a fresh chat with a prompt box is showing */
export async function openFreshChat(host, { signal, timeoutMs = 8000 } = {}) {
  if (isFreshChat(host) && host.editor()) return true;
  if (!host.openNewChat()) return false;
  const ok = await waitUntil(() => isFreshChat(host) && !!host.editor(), { timeoutMs, intervalMs: 120, signal });
  if (ok) await sleep(250, signal); // let the new page finish mounting its prompt box
  return ok;
}
