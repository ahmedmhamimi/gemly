/**
 * Storage migrations.
 *
 * Until now "versioning" was only the `-v1` suffix in key names, which can
 * express "this key's layout changed" but not "move the data". This adds a
 * stored integer (`STORAGE_KEYS.schemaVersion`; absent = 1, i.e. every install
 * that predates this file) and an ordered list of pure steps.
 *
 * Rules for a step:
 *   - `up(data)` receives a private clone of the stored values of the Store's
 *     keys (`{ [storageKey]: value }`) and mutates it in place.
 *   - It must be IDEMPOTENT and tolerate missing/garbled values: if the write
 *     that follows fails (quota), the same step runs again on the next load.
 *   - Prefer additive changes handled by a sanitizer default; add a step only
 *     when data must be moved or rewritten.
 *
 * Safety: nothing is written unless every step succeeded. A throwing step
 * leaves the stored data exactly as it was (the sanitizers still read it) and
 * the failure is reported to the caller. The caller keeps a one-slot backup of
 * the keys a successful run changed (BACKUP_KEY).
 *
 * Pure: no chrome.*, no DOM.
 */

/**
 * @typedef {Object} Migration
 * @property {number} to      version this step produces (2, 3, …, contiguous)
 * @property {string} name
 * @property {(data: Record<string, any>) => void} up
 */

/** @type {Migration[]} Append only; never edit a released step. */
export const MIGRATIONS = [];

/** Version this build reads and writes. Must equal the last migration's `to` (1 if none). */
export const SCHEMA_VERSION = 1;

export function validateMigrations(list, target) {
  let expect = 2;
  for (const m of list) {
    if (!m || m.to !== expect || typeof m.up !== 'function' || !m.name) {
      throw new Error(`migration list is not contiguous at version ${expect}`);
    }
    expect++;
  }
  if (target !== undefined && target !== expect - 1) {
    throw new Error(`SCHEMA_VERSION (${target}) does not match the last migration (${expect - 1})`);
  }
  return true;
}

/** Stored version, or 1 when absent/garbled. */
export function storedVersion(raw, versionKey) {
  const v = raw?.[versionKey];
  return Number.isInteger(v) && v >= 1 ? v : 1;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * @param {Record<string, any>} raw          everything read from storage
 * @param {{ dataKeys: string[], versionKey: string, migrations?: Migration[], target?: number }} opts
 * @returns {{
 *   ok: boolean, from: number, to: number, applied: string[],
 *   writes: Record<string, any>, removes: string[], before: Record<string, any>,
 *   newer: boolean, error?: Error,
 * }}
 *   `writes`/`removes`: what to persist (empty unless a step ran and changed something);
 *   `before`: the pre-migration value of every key that changed (for the backup slot).
 */
export function runMigrations(raw, { dataKeys, versionKey, migrations = MIGRATIONS, target = SCHEMA_VERSION }) {
  const from = storedVersion(raw, versionKey);
  const result = { ok: true, from, to: from, applied: [], writes: {}, removes: [], before: {}, newer: false };

  if (from > target) {
    // Data written by a newer build (the person downgraded): never touch it.
    result.newer = true;
    return result;
  }
  if (from === target) return result;

  try {
    validateMigrations(migrations, target);
    const data = {};
    for (const k of dataKeys) if (raw[k] !== undefined) data[k] = structuredClone(raw[k]);
    const working = structuredClone(data);

    for (const m of migrations.filter((x) => x.to > from && x.to <= target)) {
      m.up(working);
      result.applied.push(m.name);
    }

    for (const k of new Set([...Object.keys(data), ...Object.keys(working)])) {
      if (working[k] === undefined) {
        if (data[k] !== undefined) {
          result.removes.push(k);
          result.before[k] = data[k];
        }
      } else if (!same(working[k], data[k])) {
        result.writes[k] = working[k];
        if (data[k] !== undefined) result.before[k] = data[k];
      }
    }
    result.to = target;
    return result;
  } catch (error) {
    return { ok: false, from, to: from, applied: [], writes: {}, removes: [], before: {}, newer: false, error };
  }
}
