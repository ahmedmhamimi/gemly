/**
 * Content-script side of the chat archive (background/archive.js).
 *
 * Every call is one trusted runtime message. Large writes are split into
 * batches bounded by count AND size (a runtime message is capped at 64 MiB and
 * a huge structured clone would stall the page). Failures throw ArchiveError
 * with a short code; callers show a toast and carry on.
 */
import { MSG } from './config.js';

export class ArchiveError extends Error {}

export const BATCH = Object.freeze({ maxRecords: 40, maxChars: 3_000_000 });

/** Split records so no batch exceeds the count or the (estimated) size. Pure. */
export function batchRecords(records, { maxRecords = BATCH.maxRecords, maxChars = BATCH.maxChars } = {}) {
  const batches = [];
  let cur = [];
  let size = 0;
  for (const rec of records) {
    const n = rec.messages.reduce((s, m) => s + (m.text?.length || 0) + (m.html?.length || 0), 0) + 200;
    if (cur.length && (cur.length >= maxRecords || size + n > maxChars)) {
      batches.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(rec);
    size += n;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

async function call(op, args) {
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: MSG.archive, op, args });
  } catch (err) {
    throw new ArchiveError(String(err?.message || err));
  }
  if (!res?.ok) throw new ArchiveError(res?.error || 'no-response');
  return res;
}

export const ArchiveClient = {
  /** @returns {Promise<{ saved: number, unchanged: number, rejected: number }>} */
  async putChats(records) {
    const total = { saved: 0, unchanged: 0, rejected: 0 };
    for (const batch of batchRecords(records)) {
      const r = await call('putChats', { records: batch });
      total.saved += r.saved;
      total.unchanged += r.unchanged;
      total.rejected += r.rejected;
    }
    return total;
  },
  async getChats(ids) {
    const out = [];
    for (let i = 0; i < ids.length; i += BATCH.maxRecords) out.push(...(await call('getChats', { ids: ids.slice(i, i + BATCH.maxRecords) })).chats);
    return out;
  },
  /**
   * Save what the page currently shows for a chat WITHOUT clobbering a fuller stored copy
   * (the page may render only the latest messages). Used by automatic saving.
   */
  async putSeen(records) {
    const total = { saved: 0, unchanged: 0, rejected: 0 };
    for (const batch of batchRecords(records)) {
      const r = await call('putSeen', { records: batch });
      total.saved += r.saved;
      total.unchanged += r.unchanged;
      total.rejected += r.rejected;
    }
    return total;
  },
  /** @returns {Promise<{ results: object[], total: number, truncated: boolean, tokens: string[] }>} */
  async search({ query, ids = null, from = null, to = null, limit = 50 }) {
    const { results, total, truncated, tokens } = await call('search', { query, ids, from, to, limit });
    return { results, total, truncated, tokens };
  },
  /** @returns {Promise<{ chats: number, tokens: number, archived: number }>} */
  async indexStats() {
    const { chats, tokens, archived } = await call('indexStats');
    return { chats, tokens, archived };
  },
  indexBatch: async (ids) => (await call('indexBatch', { ids })).indexed,
  indexClear: async () => void (await call('indexClear')),
  list: async () => (await call('list')).rows,
  stats: async () => {
    const { count, bytes } = await call('stats');
    return { count, bytes };
  },
  deleteChats: async (ids) => (await call('deleteChats', { ids })).deleted,
  clear: async () => void (await call('clear')),
};
