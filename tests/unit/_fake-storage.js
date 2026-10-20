/** Fake chrome.storage areas for sync tests. The sync area enforces Chrome's real quotas. */
const bytes = (k, v) => new TextEncoder().encode(k).length + new TextEncoder().encode(JSON.stringify(v)).length;

export class FakeArea {
  constructor({ quota = null } = {}) {
    this.data = {};
    this.quota = quota; // { item, total, items } for the sync area
    this.listeners = new Set();
    this.writes = 0;
  }

  _emit(changes) {
    for (const l of this.listeners) l(structuredClone(changes));
  }

  async get(keys) {
    if (keys == null) return structuredClone(this.data);
    const list = typeof keys === 'string' ? [keys] : keys;
    return Object.fromEntries(list.filter((k) => k in this.data).map((k) => [k, structuredClone(this.data[k])]));
  }

  async set(obj) {
    if (this.quota) {
      const next = { ...this.data, ...obj };
      for (const [k, v] of Object.entries(obj)) if (bytes(k, v) > this.quota.item) throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
      if (Object.entries(next).reduce((n, [k, v]) => n + bytes(k, v), 0) > this.quota.total) throw new Error('QUOTA_BYTES quota exceeded');
      if (Object.keys(next).length > this.quota.items) throw new Error('MAX_ITEMS quota exceeded');
    }
    const changes = {};
    for (const [k, v] of Object.entries(obj)) {
      changes[k] = { oldValue: this.data[k], newValue: structuredClone(v) };
      this.data[k] = structuredClone(v);
    }
    this.writes++;
    this._emit(changes);
  }

  async remove(keys) {
    const changes = {};
    for (const k of typeof keys === 'string' ? [keys] : keys) {
      if (k in this.data) changes[k] = { oldValue: this.data[k] };
      delete this.data[k];
    }
    if (Object.keys(changes).length) this._emit(changes);
  }

  async getBytesInUse() {
    return Object.entries(this.data).reduce((n, [k, v]) => n + bytes(k, v), 0);
  }
}

export const syncQuota = () => ({ item: 8192, total: 102400, items: 512 });
