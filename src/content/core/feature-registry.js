/**
 * Central feature registry: the one mechanism that decides which features are
 * on. Knows nothing about any particular feature (see features/manifest.js for
 * the table itself).
 *
 * A *feature* is a unique id with an on/off state. One feature can own several
 * *facets* spread over different hosts:
 *
 *   app     the Feature object handed to App (init/scan/teardown)
 *   widget  a bar widget      (registerBarWidget)
 *   action  a message action  (registerMessageAction)
 *   hook    a send hook       (registerSendHook)
 *   section a Settings panel section (registerSettingsSection)
 *
 * so switching the id off removes all of them together, without editing the
 * feature's own code.
 *
 * Resolution order for every feature:
 *   1. manifest `enabled`            (developer kill switch, the single place;
 *                                     `false` cannot be overridden by the user)
 *   2. user override from the Store  (can only switch a feature OFF; ignored
 *                                     when the row is `locked`)
 *   3. `requires`: a feature whose requirement is off is off too
 *
 * Failure policy: asking about an id nobody registered answers "enabled" and
 * warns once. A missing row must never silently remove a working feature in
 * production; the manifest unit test turns the same mistake into a failure.
 * This module is pure (no DOM, no chrome.*).
 */
import { createLogger } from './log.js';

const log = createLogger('features');

export const FEATURE_ID = /^[a-z][a-z0-9-]{1,40}$/;
export const FACET_KINDS = Object.freeze(['widget', 'action', 'hook', 'section']);

/**
 * @typedef {Object} FeatureDef
 * @property {string} id
 * @property {boolean} [enabled=true]   developer switch
 * @property {boolean} [locked=false]   the user cannot switch it off from Settings
 * @property {string[]} [requires]      ids that must be on for this one to work
 * @property {{ id: string }} [app]     the App Feature (its `id` must equal `id`)
 * @property {string[]} [widgets]
 * @property {string[]} [actions]
 * @property {string[]} [hooks]
 * @property {string[]} [sections]
 */

/**
 * Validate a table of definitions. Throws on the first structural problem so a
 * bad manifest fails loudly in tests and at startup.
 * @param {FeatureDef[]} defs
 */
export function validateDefs(defs) {
  if (!Array.isArray(defs)) throw new Error('feature definitions must be an array');
  const byId = new Map();
  const owners = new Map();
  for (const d of defs) {
    if (!d || typeof d.id !== 'string' || !FEATURE_ID.test(d.id)) throw new Error(`invalid feature id ${JSON.stringify(d?.id)}`);
    if (byId.has(d.id)) throw new Error(`duplicate feature id "${d.id}"`);
    if (d.app && d.app.id !== d.id) throw new Error(`feature "${d.id}" is bound to an app feature with a different id ("${d.app.id}")`);
    byId.set(d.id, d);
    for (const kind of FACET_KINDS) {
      for (const facetId of d[`${kind}s`] || []) {
        const key = `${kind}:${facetId}`;
        if (owners.has(key)) throw new Error(`${kind} "${facetId}" is claimed by both "${owners.get(key)}" and "${d.id}"`);
        owners.set(key, d.id);
      }
    }
  }
  for (const d of defs) {
    for (const r of d.requires || []) {
      if (!byId.has(r)) throw new Error(`feature "${d.id}" requires unknown feature "${r}"`);
      if (r === d.id) throw new Error(`feature "${d.id}" requires itself`);
    }
  }
  // Cycles in `requires` (depth-first with colours).
  const state = new Map();
  const visit = (id, path) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) throw new Error(`requires cycle: ${[...path, id].join(' -> ')}`);
    state.set(id, 1);
    for (const r of byId.get(id).requires || []) visit(r, [...path, id]);
    state.set(id, 2);
  };
  for (const id of byId.keys()) visit(id, []);
  return { byId, owners };
}

/**
 * Pure resolution. `overrides` is the sanitized `{ id: boolean }` user map.
 * @param {FeatureDef[]} defs
 * @param {Record<string, boolean>} [overrides]
 * @returns {Map<string, { enabled: boolean, source: 'default'|'config'|'override'|'dependency', reason: string|null }>}
 */
export function resolveFlags(defs, overrides = {}) {
  const out = new Map();
  for (const d of defs) {
    // The manifest switch is a hard kill switch (e.g. ship a build with a feature
    // off after Gemini changed its markup): a user override can never re-enable it.
    // An override can only switch a feature the developer left on OFF, and not at
    // all for `locked` rows.
    const configOn = d.enabled !== false;
    const userOff = configOn && !d.locked && overrides[d.id] === false;
    const enabled = configOn && !userOff;
    out.set(d.id, {
      enabled,
      source: !configOn ? 'config' : userOff ? 'override' : 'default',
      reason: enabled ? null : userOff ? 'switched off in settings' : 'disabled in manifest',
    });
  }
  // Dependencies, to a fixpoint (a dependent of a dependent goes off too).
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of defs) {
      const cur = out.get(d.id);
      if (!cur.enabled) continue;
      const missing = (d.requires || []).find((r) => !out.get(r)?.enabled);
      if (missing) {
        out.set(d.id, { enabled: false, source: 'dependency', reason: `requires "${missing}"` });
        changed = true;
      }
    }
  }
  return out;
}

class FeatureRegistry {
  constructor() {
    this.reset();
  }

  /** Forget everything (tests). */
  reset() {
    /** @type {FeatureDef[]} */
    this._defs = [];
    this._owners = new Map();
    this._flags = new Map();
    this._version = 0;
  }

  /** Register the table once. Throws on structural errors. @param {FeatureDef[]} defs */
  define(defs) {
    const { owners } = validateDefs(defs);
    this._defs = defs;
    this._owners = owners;
    this._flags = resolveFlags(defs, {});
    this._version++;
    return this;
  }

  /** Apply the user's overrides (call after the Store has loaded). */
  resolve(overrides = {}) {
    this._flags = resolveFlags(this._defs, overrides || {});
    this._version++;
    return this._flags;
  }

  /** Bumps whenever the answer to isEnabled() could have changed (cache key). */
  get version() {
    return this._version;
  }

  defs() {
    return this._defs;
  }

  ids() {
    return this._defs.map((d) => d.id);
  }

  has(id) {
    return this._flags.has(id);
  }

  /** Unknown ids are "enabled" (see failure policy above). */
  isEnabled(id) {
    const f = this._flags.get(id);
    if (!f) {
      if (this._defs.length) log.warnOnce(`unknown:${id}`, `feature "${id}" is not in features/manifest.js - treating it as enabled`);
      return true;
    }
    return f.enabled;
  }

  /** Which feature owns this widget/action/hook id? `undefined` if nobody does. */
  ownerOf(kind, facetId) {
    return this._owners.get(`${kind}:${facetId}`);
  }

  isFacetEnabled(kind, facetId) {
    const owner = this.ownerOf(kind, facetId);
    if (!owner) {
      if (this._defs.length) log.warnOnce(`facet:${kind}:${facetId}`, `${kind} "${facetId}" is not owned by any feature in features/manifest.js - treating it as enabled`);
      return true;
    }
    return this.isEnabled(owner);
  }

  /** Items of a registry whose owner is on. Memoise per `version` at the call site if hot. */
  filterFacets(kind, items) {
    return items.filter((it) => this.isFacetEnabled(kind, it.id));
  }

  reason(id) {
    return this._flags.get(id)?.reason ?? null;
  }

  /** For __gemly.diagnose() and the Settings panel. */
  report() {
    return this._defs.map((d) => {
      const f = this._flags.get(d.id);
      return { id: d.id, enabled: f.enabled, source: f.source, reason: f.reason, locked: !!d.locked };
    });
  }
}

export const Features = new FeatureRegistry();
