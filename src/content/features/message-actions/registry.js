/**
 * Registry for controls Gemly adds to each reply's action row (next to
 * Gemini's own copy / thumbs buttons).
 *
 * @typedef {Object} MessageAction
 * @property {string} id
 * @property {number} order
 * @property {(turn: Element, ctx: import('../../core/app.js').AppContext) => HTMLElement} build
 * @property {(el: HTMLElement, turn: Element, info: {isLast: boolean, generating: boolean}, ctx: import('../../core/app.js').AppContext) => void} [update]
 */
import { Features } from '../../core/feature-registry.js';

/** @type {MessageAction[]} */
const actions = [];
let cache = { version: -1, size: -1, list: [] };

export function registerMessageAction(action) {
  if (actions.some((a) => a.id === action.id)) throw new Error(`Duplicate message action "${action.id}"`);
  actions.push(action);
  actions.sort((a, b) => a.order - b.order);
}

/** Actions whose owning feature is on (memoised: asked for on every scan). */
export function messageActions() {
  if (cache.version !== Features.version || cache.size !== actions.length) {
    cache = { version: Features.version, size: actions.length, list: Features.filterFacets('action', actions) };
  }
  return cache.list;
}

/** Every registered id, on or off (manifest test). */
export const registeredMessageActionIds = () => actions.map((a) => a.id);
