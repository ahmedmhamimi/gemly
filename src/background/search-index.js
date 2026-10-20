/**
 * Full-text index over the archive, kept in the service worker's IndexedDB.
 *
 *   postings: token -> { ids: string[] }          which chats contain the token
 *   terms:    chatId -> { tokens, sig, at }       what a chat contributed (so a
 *                                                 changed/deleted chat can be removed),
 *                                                 plus its date for filtering
 *
 * Indexing is incremental and idempotent: a chat whose signature is unchanged is
 * skipped; a changed one is diffed against its previous tokens. Queries are
 * AND over all terms with prefix matching on the last one, then ranked on the
 * (few) candidate documents. Nothing here touches the page.
 *
 * The backend interface is shared with archive.js (MemoryBackend in tests).
 */
import { recordSignature } from '../content/features/export/serialize/record.js';
import { buildSnippets, highlightRanges, matchCounts, scoreFromCounts } from '../content/features/archive-search/snippets.js';
import { queryTokens, tokenize } from '../content/features/archive-search/tokenize.js';
import { STORES } from './stores.js';

export const SEARCH_LIMITS = Object.freeze({ candidates: 300, prefixKeys: 64, results: 100 });

const savedText = (s) => (s ? `\n${[...s.bookmarks.map((b) => `${b.snippet} ${b.note || ''}`), ...s.highlights.map((h) => `${h.quote} ${h.note || ''}`)].join('\n')}` : '');
const docText = (rec) => `${rec.title}\n${rec.messages.map((m) => m.text).join('\n')}${savedText(rec.saved)}`;

/** Intersection of Sets, smallest first. */
function intersect(sets) {
  if (!sets.length) return new Set();
  const sorted = [...sets].sort((a, b) => a.size - b.size);
  let out = new Set(sorted[0]);
  for (const s of sorted.slice(1)) {
    out = new Set([...out].filter((x) => s.has(x)));
    if (!out.size) break;
  }
  return out;
}

export class SearchIndex {
  constructor(backend) {
    this.db = backend;
  }

  /** @returns {{ indexed: number, skipped: number }} */
  async indexChats(records) {
    const ids = records.map((r) => r.id);
    const olds = await this.db.getMany(STORES.terms, ids);
    const delta = new Map(); // token -> { add: Set<id>, del: Set<id> }
    const bucket = (t) => {
      let b = delta.get(t);
      if (!b) delta.set(t, (b = { add: new Set(), del: new Set() }));
      return b;
    };
    const termEntries = [];
    let skipped = 0;

    records.forEach((rec, i) => {
      const sig = recordSignature(rec);
      const old = olds[i];
      if (old && old.sig === sig) {
        skipped++;
        return;
      }
      const tokens = tokenize(docText(rec));
      const oldSet = new Set(old?.tokens || []);
      const newSet = new Set(tokens);
      for (const t of newSet) if (!oldSet.has(t)) bucket(t).add.add(rec.id);
      for (const t of oldSet) if (!newSet.has(t)) bucket(t).del.add(rec.id);
      termEntries.push([rec.id, { tokens, sig, at: rec.capturedAt || Date.now() }]);
    });

    await this._applyDelta(delta);
    if (termEntries.length) await this.db.putMany(STORES.terms, termEntries);
    return { indexed: termEntries.length, skipped };
  }

  async removeChats(ids) {
    const olds = await this.db.getMany(STORES.terms, ids);
    const delta = new Map();
    olds.forEach((old, i) => {
      for (const t of old?.tokens || []) {
        if (!delta.has(t)) delta.set(t, { add: new Set(), del: new Set() });
        delta.get(t).del.add(ids[i]);
      }
    });
    await this._applyDelta(delta);
    await this.db.delete(STORES.terms, ids);
    return { removed: olds.filter(Boolean).length };
  }

  async clear() {
    await this.db.clear(STORES.postings);
    await this.db.clear(STORES.terms);
  }

  async stats() {
    return { chats: await this.db.count(STORES.terms), tokens: await this.db.count(STORES.postings) };
  }

  async _applyDelta(delta) {
    const tokens = [...delta.keys()];
    if (!tokens.length) return;
    const current = await this.db.getMany(STORES.postings, tokens);
    const writes = [];
    const deletes = [];
    tokens.forEach((t, i) => {
      const { add, del } = delta.get(t);
      const ids = new Set(current[i]?.ids || []);
      for (const id of del) ids.delete(id);
      for (const id of add) ids.add(id);
      if (ids.size) writes.push([t, { ids: [...ids] }]);
      else if (current[i]) deletes.push(t);
    });
    if (writes.length) await this.db.putMany(STORES.postings, writes);
    if (deletes.length) await this.db.delete(STORES.postings, deletes);
  }

  /**
   * @param {{ query: string, ids?: string[]|null, from?: number|null, to?: number|null, limit?: number }} q
   * @param {(ids: string[]) => Promise<object[]>} load  fetches ChatRecords (the archive)
   */
  async search({ query, ids = null, from = null, to = null, limit = 50 }, load) {
    const tokens = queryTokens(query);
    if (!tokens.length) return { tokens: [], results: [], total: 0, truncated: false };
    const exact = tokens.slice(0, -1);
    const lastTok = tokens[tokens.length - 1];

    const sets = [];
    const exactRows = exact.length ? await this.db.getMany(STORES.postings, exact) : [];
    for (const row of exactRows) {
      if (!row) return { tokens, results: [], total: 0, truncated: false };
      sets.push(new Set(row.ids));
    }
    const keys = await this.db.prefixKeys(STORES.postings, lastTok, SEARCH_LIMITS.prefixKeys);
    if (!keys.length) return { tokens, results: [], total: 0, truncated: false };
    const union = new Set();
    for (const row of await this.db.getMany(STORES.postings, keys)) for (const id of row?.ids || []) union.add(id);
    sets.push(union);

    let cand = intersect(sets);
    if (ids) {
      const allowed = new Set(ids);
      cand = new Set([...cand].filter((id) => allowed.has(id)));
    }

    // Dates come from the small `terms` rows, so filtering does not load any chat.
    const list = [...cand];
    const meta = await this.db.getMany(STORES.terms, list);
    let rows = list.map((id, i) => ({ id, at: meta[i]?.at || 0 }));
    if (from != null) rows = rows.filter((r) => r.at >= from);
    if (to != null) rows = rows.filter((r) => r.at <= to);
    rows.sort((a, b) => b.at - a.at);
    const total = rows.length;
    const truncated = total > SEARCH_LIMITS.candidates;
    rows = rows.slice(0, SEARCH_LIMITS.candidates);

    const records = await load(rows.map((r) => r.id));
    const atOf = new Map(rows.map((r) => [r.id, r.at]));
    // Pass 1: ONE tokenizer pass per message gives the document score and the best messages.
    const scored = records.map((rec) => {
      const docCounts = matchCounts(rec.title, tokens, 8);
      const perMessage = rec.messages.map((m, i) => {
        const c = matchCounts(m.text, tokens);
        c.forEach((n, k) => (docCounts[k] += n));
        return { i, m, sc: scoreFromCounts(c) };
      });
      return { rec, score: scoreFromCounts(docCounts), perMessage };
    });
    scored.sort((a, b) => b.score - a.score || (atOf.get(b.rec.id) || 0) - (atOf.get(a.rec.id) || 0));

    // Pass 2: snippets and highlights only for what is actually returned.
    const results = scored.slice(0, Math.min(limit, SEARCH_LIMITS.results)).map(({ rec, score, perMessage }) => ({
      id: rec.id,
      title: rec.title,
      path: rec.path,
      at: atOf.get(rec.id) || rec.capturedAt || 0,
      messages: rec.messages.length,
      score,
      titleRanges: highlightRanges(rec.title, tokens),
      snippets: perMessage
        .filter((x) => x.sc > 0)
        .sort((a, b) => b.sc - a.sc || a.i - b.i)
        .slice(0, 2)
        .sort((a, b) => a.i - b.i)
        .flatMap(({ m }) => buildSnippets(m.text, tokens, { max: 1 }).map((sn) => ({ ...sn, role: m.role }))),
    }));
    return { tokens, results, total, truncated };
  }
}
