/**
 * Chat archive, kept in the service worker's IndexedDB (extension origin).
 *
 * Why here and not in the content script: a content script's `indexedDB` is the
 * PAGE's (gemini.google.com), readable by Gemini's own scripts and wiped with the
 * site's data. The service worker's database belongs to the extension alone, and
 * is not subject to chrome.storage.local's 10 MB quota, so no `unlimitedStorage`
 * permission is needed.
 *
 * Layers (so the logic is testable without a browser):
 *   Archive        operations + validation       <- unit tests, MemoryBackend
 *   IdbBackend     thin IndexedDB adapter        <- needs a real browser
 *   handleArchive  message entry point           <- called by background/index.js
 *
 * Stored value per chat: { id, record, sig, size, savedAt } keyed by chat id.
 */
import { mergeRecords } from '../content/features/archive-search/merge-records.js';
import { recordSignature, sanitizeRecord } from '../content/features/export/serialize/record.js';
import { SearchIndex } from './search-index.js';
import { DB_NAME, DB_VERSION, STORES } from './stores.js';

export { DB_NAME, DB_VERSION, STORES };
const MAX_IDS = 2000;
const ID = /^[\w.:-]{1,80}$/;

/** In-memory backend with the same contract as IdbBackend (tests, and a fallback). */
export class MemoryBackend {
  constructor() {
    this.stores = { chats: new Map(), meta: new Map(), postings: new Map(), terms: new Map() };
  }

  async get(store, key) {
    const v = this.stores[store].get(key);
    return v === undefined ? undefined : structuredClone(v);
  }

  async getMany(store, keys) {
    return keys.map((k) => this.stores[store].get(k)).map((v) => (v === undefined ? undefined : structuredClone(v)));
  }

  async put(store, key, value) {
    this.stores[store].set(key, structuredClone(value));
  }

  async putMany(store, entries) {
    for (const [k, v] of entries) this.stores[store].set(k, structuredClone(v));
  }

  async delete(store, keys) {
    for (const k of keys) this.stores[store].delete(k);
  }

  async all(store) {
    return [...this.stores[store].values()].map((v) => structuredClone(v));
  }

  async clear(store) {
    this.stores[store].clear();
  }

  async count(store) {
    return this.stores[store].size;
  }

  /** Keys starting with `prefix`, sorted, at most `limit`. */
  async prefixKeys(store, prefix, limit) {
    return [...this.stores[store].keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit);
  }
}

/** IndexedDB adapter. Every call is one transaction; errors reject. */
export class IdbBackend {
  constructor(factory = globalThis.indexedDB) {
    this._factory = factory;
    this._db = null;
  }

  _open() {
    this._db ??= new Promise((resolve, reject) => {
      const req = this._factory.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORES.chats)) db.createObjectStore(STORES.chats, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORES.meta)) db.createObjectStore(STORES.meta);
        if (!db.objectStoreNames.contains(STORES.postings)) db.createObjectStore(STORES.postings);
        if (!db.objectStoreNames.contains(STORES.terms)) db.createObjectStore(STORES.terms);
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          this._db = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        this._db = null;
        reject(req.error);
      };
      req.onblocked = () => reject(new Error('archive database is blocked by another connection'));
    });
    return this._db;
  }

  async get(store, key) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  }

  async getMany(store, keys) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const reqs = keys.map((k) => tx.objectStore(store).get(k));
      tx.oncomplete = () => resolve(reqs.map((r) => r.result));
      tx.onerror = () => reject(tx.error);
    });
  }

  async put(store, key, value) {
    const keyed = store === STORES.chats;
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      if (keyed) tx.objectStore(store).put(value);
      else tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
    });
  }

  async putMany(store, entries) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      for (const [k, v] of entries) (store === STORES.chats ? os.put(v) : os.put(v, k));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
    });
  }

  async delete(store, keys) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      for (const k of keys) tx.objectStore(store).delete(k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async all(store) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  }

  async clear(store) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async count(store) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).count();
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  }

  async prefixKeys(store, prefix, limit) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const range = globalThis.IDBKeyRange.bound(prefix, `${prefix}\uffff`);
      const req = tx.objectStore(store).getAllKeys(range, limit);
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  }
}

const idList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && ID.test(x)).slice(0, MAX_IDS) : []);

export class Archive {
  /** @param {MemoryBackend|IdbBackend} backend */
  constructor(backend) {
    this.db = backend;
    this.index = new SearchIndex(backend);
  }

  /**
   * Save records and (re)index them. A record whose content is unchanged is not
   * rewritten. With `merge`, a possibly partial view of a chat is aligned to the
   * stored copy instead of replacing it (see mergeRecords).
   * @returns {{ saved: number, unchanged: number, rejected: number, indexError?: string }}
   */
  async putChats(records, { merge = false } = {}) {
    let clean = [];
    let rejected = 0;
    for (const raw of Array.isArray(records) ? records.slice(0, 200) : []) {
      const rec = sanitizeRecord(raw);
      if (rec) clean.push(rec);
      else rejected++;
    }
    const existing = await this.db.getMany(STORES.chats, clean.map((r) => r.id));
    if (merge) clean = clean.map((rec, i) => (existing[i] ? sanitizeRecord(mergeRecords(existing[i].record, rec)) || rec : rec));
    const entries = [];
    const changed = [];
    let unchanged = 0;
    clean.forEach((rec, i) => {
      const sig = recordSignature(rec);
      const old = existing[i];
      if (old && old.sig === sig && old.record.title === rec.title && old.record.path === rec.path) {
        unchanged++;
        return;
      }
      changed.push(rec);
      entries.push([rec.id, { id: rec.id, record: rec, sig, size: JSON.stringify(rec).length, savedAt: Date.now() }]);
    });
    if (entries.length) await this.db.putMany(STORES.chats, entries);
    const out = { saved: entries.length, unchanged, rejected };
    // Index everything that was passed in (cheap skip when its signature is already indexed),
    // so an archive saved before the index existed heals itself. A failing index never fails the save.
    try {
      await this.index.indexChats(clean);
    } catch (err) {
      out.indexError = String(err?.message || err).slice(0, 120);
    }
    return out;
  }

  async getChats(ids) {
    const rows = await this.db.getMany(STORES.chats, idList(ids));
    return rows.filter(Boolean).map((r) => r.record);
  }

  /** Lightweight rows for lists (no message bodies). */
  async list() {
    const rows = await this.db.all(STORES.chats);
    return rows
      .map((r) => ({ id: r.id, title: r.record.title, path: r.record.path, capturedAt: r.record.capturedAt, messages: r.record.messages.length, size: r.size, savedAt: r.savedAt, sig: r.sig }))
      .sort((a, b) => b.savedAt - a.savedAt);
  }

  async deleteChats(ids) {
    const list = idList(ids);
    await this.db.delete(STORES.chats, list);
    let indexError;
    try {
      await this.index.removeChats(list);
    } catch (err) {
      indexError = String(err?.message || err).slice(0, 120);
    }
    return { deleted: list.length, ...(indexError ? { indexError } : {}) };
  }

  async clear() {
    await this.db.clear(STORES.chats);
    await this.index.clear();
    return { cleared: true };
  }

  async stats() {
    const rows = await this.db.all(STORES.chats);
    return { count: rows.length, bytes: rows.reduce((n, r) => n + (r.size || 0), 0) };
  }

  /** Index health for the Settings panel. `archived` > `indexed` means the index is incomplete. */
  async indexStats() {
    return { ...(await this.index.stats()), archived: await this.db.count(STORES.chats) };
  }

  /** Index (more) archived chats by id: the rebuild loop calls this in small batches. */
  async indexBatch(ids) {
    const records = await this.getChats(ids);
    return this.index.indexChats(records);
  }

  async search(args) {
    const a = args && typeof args === 'object' ? args : {};
    const num = (v) => (Number.isFinite(v) ? v : null);
    return this.index.search(
      {
        query: String(a.query ?? '').slice(0, 300),
        ids: Array.isArray(a.ids) ? idList(a.ids.slice(0, 20000)).slice(0, 20000) : null,
        from: num(a.from),
        to: num(a.to),
        limit: Math.min(Math.max(Number(a.limit) || 50, 1), 100),
      },
      (ids) => this.getChats(ids.slice(0, 300)),
    );
  }

  /** Message entry point. Always resolves to `{ ok, ... }`; never throws. */
  async handle(op, args = {}) {
    try {
      switch (op) {
        case 'putChats': return { ok: true, ...(await this.putChats(args.records)) };
        case 'putSeen': return { ok: true, ...(await this.putChats(args.records, { merge: true })) };
        case 'getChats': return { ok: true, chats: await this.getChats(args.ids) };
        case 'list': return { ok: true, rows: await this.list() };
        case 'deleteChats': return { ok: true, ...(await this.deleteChats(args.ids)) };
        case 'clear': return { ok: true, ...(await this.clear()) };
        case 'stats': return { ok: true, ...(await this.stats()) };
        case 'search': return { ok: true, ...(await this.search(args)) };
        case 'indexStats': return { ok: true, ...(await this.indexStats()) };
        case 'indexBatch': return { ok: true, ...(await this.indexBatch(args.ids)) };
        case 'indexClear': return { ok: true, ...(await this.index.clear().then(() => ({ cleared: true }))) };
        default: return { ok: false, error: 'unknown-op' };
      }
    } catch (err) {
      return { ok: false, error: String(err?.message || err).slice(0, 200) };
    }
  }
}

let shared = null;
/** The service worker's archive (lazily opened). */
export const sharedArchive = () => (shared ??= new Archive(new IdbBackend()));
