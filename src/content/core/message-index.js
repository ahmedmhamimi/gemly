/**
 * Per-turn cache of derived message data (token estimate, hash, text head).
 *
 * Several features need facts about every message on every scan (context
 * meter, token badges, bookmarks). Recomputing from the DOM each time would
 * be O(total chat size) per scan; instead each turn is computed once and only
 * recomputed after the app saw a DOM mutation inside it (`invalidate`).
 * Keyed by the live element in a WeakMap, so entries vanish with their nodes.
 */
import { CONFIG } from './config.js';
import { GeminiHost as host } from '../host/gemini.js';
import { collapseWhitespace, hashText } from '../util/text.js';
import { estimateCodeTokens, estimateTokens } from '../util/tokens.js';

const HEAD_CHARS = 400;

/**
 * @typedef {Object} TurnEntry
 * @property {'user'|'assistant'} role
 * @property {number} tokens   estimated tokens
 * @property {string} hash     content hash (first 4000 chars)
 * @property {string} head     first ~400 chars, whitespace-collapsed
 * @property {number} length   text length
 */

export class MessageIndex {
  constructor() {
    this._entries = new WeakMap();
    this._dirty = new WeakSet();
    this._epoch = 0;
  }

  /** Mark one turn as changed. */
  invalidate(turn) {
    this._dirty.add(turn);
  }

  /** Mark everything as changed (navigation, store reset, tests). */
  invalidateAll() {
    this._epoch++;
  }

  /** @returns {TurnEntry} */
  entry(turn) {
    const cached = this._entries.get(turn);
    if (cached && cached.epoch === this._epoch && !this._dirty.has(turn)) return cached;
    this._dirty.delete(turn);
    const fresh = this._compute(turn);
    this._entries.set(turn, fresh);
    return fresh;
  }

  _compute(turn) {
    const user = host.isUserTurn(turn);
    const root = (user ? host.userTextRoot(turn) : host.assistantRoot(turn)) || turn;
    // textContent (not innerText): no layout, so safe to call while streaming.
    const raw = root.textContent || '';
    const plain = collapseWhitespace(raw);

    let tokens = estimateTokens(raw);
    if (!user) {
      let codeChars = 0;
      root.querySelectorAll('pre').forEach((pre) => {
        codeChars += (pre.textContent || '').length;
      });
      if (codeChars) {
        // Re-price the code portion at the code ratio instead of the prose one.
        tokens = Math.max(
          1,
          Math.round(tokens - codeChars / CONFIG.tokens.latin + estimateCodeTokens(codeChars)),
        );
      }
    }

    return {
      epoch: this._epoch,
      role: user ? 'user' : 'assistant',
      tokens,
      hash: hashText(plain.slice(0, 4000)),
      head: plain.slice(0, HEAD_CHARS),
      length: raw.length,
    };
  }

  totalTokens(turns) {
    let total = 0;
    for (const t of turns) total += this.entry(t).tokens;
    return total;
  }
}
