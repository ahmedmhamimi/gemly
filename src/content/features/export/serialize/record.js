/**
 * ChatRecord: the one stored/exported shape of a conversation.
 *
 *   { id, title, path, capturedAt, messages: [{ role, text, html? }] }
 *
 * `text` is plain (search index, JSON consumers); `html` is the sanitized
 * markup the extractor produced (assistant messages only) so Markdown/HTML/PDF
 * exports keep their structure. Everything that did not come from the live page
 * (an imported backup) goes through sanitizeRecord(): shape, limits and
 * whitelisted HTML are enforced there and nowhere else.
 */
import { cleanNote } from '../../../core/schema.js';
import { cleanLabel } from '../../../util/text.js';
import { sanitizeHtml, toText } from './markup.js';

export const RECORD_VERSION = 1;
export const LIMITS = Object.freeze({ title: 200, messages: 5000, textChars: 400_000, htmlChars: 1_000_000, saved: 200 });

const ID = /^[\w.:-]{1,80}$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * From the live-page shape (`extractConversation()`): `{ title, messages: [{ role, content, isHTML }] }`.
 * @returns {object|null} null when the chat has no usable id or no messages
 */
export function makeRecord({ id, title, path, conversation, capturedAt = Date.now() }) {
  return sanitizeRecord({
    id,
    title: title ?? conversation?.title,
    path,
    capturedAt,
    saved: conversation?.saved,
    messages: (conversation?.messages || []).map((m) =>
      m.isHTML ? { role: m.role, html: m.content } : { role: m.role, text: m.content },
    ),
  });
}

/**
 * The person's own annotations on a chat (starred messages, highlights, notes), as exports carry them.
 * @returns {{ bookmarks: { snippet: string, role: string, note?: string }[], highlights: { quote: string, note?: string }[] } | null}
 */
export function sanitizeSaved(raw) {
  if (!isObj(raw)) return null;
  const note = (n) => (cleanNote(n) ? { note: cleanNote(n) } : {});
  const bookmarks = (Array.isArray(raw.bookmarks) ? raw.bookmarks : [])
    .filter((b) => isObj(b) && cleanLabel(b.snippet, 200))
    .slice(0, LIMITS.saved)
    .map((b) => ({ snippet: cleanLabel(b.snippet, 200), role: b.role === 'user' ? 'user' : 'assistant', ...note(b.note) }));
  const highlights = (Array.isArray(raw.highlights) ? raw.highlights : [])
    .filter((h) => isObj(h) && typeof h.quote === 'string' && h.quote.trim())
    .slice(0, LIMITS.saved)
    .map((h) => ({ quote: h.quote.replace(/\s+/g, ' ').trim().slice(0, 600), ...note(h.note) }));
  return bookmarks.length || highlights.length ? { bookmarks, highlights } : null;
}

/** @returns {object|null} a clean record, or null if it is unusable */
export function sanitizeRecord(raw) {
  if (!isObj(raw) || typeof raw.id !== 'string' || !ID.test(raw.id) || !Array.isArray(raw.messages)) return null;
  const messages = [];
  for (const m of raw.messages.slice(0, LIMITS.messages)) {
    if (!isObj(m)) continue;
    const role = m.role === 'user' ? 'user' : 'assistant';
    let html = '';
    let text = typeof m.text === 'string' ? m.text : '';
    if (role === 'assistant' && typeof m.html === 'string' && m.html) {
      html = sanitizeHtml(m.html.slice(0, LIMITS.htmlChars));
      if (!text) text = toText(html);
    }
    text = text.slice(0, LIMITS.textChars).trim();
    if (!text && !html) continue;
    messages.push(html ? { role, text, html } : { role, text });
  }
  if (!messages.length) return null;
  const path = typeof raw.path === 'string' && raw.path.startsWith('/') && !raw.path.startsWith('//') ? raw.path.slice(0, 300) : null;
  const saved = sanitizeSaved(raw.saved);
  return {
    id: raw.id,
    title: cleanLabel(raw.title, LIMITS.title) || 'Conversation',
    path,
    capturedAt: Number.isFinite(raw.capturedAt) ? raw.capturedAt : 0,
    messages,
    ...(saved ? { saved } : {}),
  };
}

/** Stable content fingerprint used to skip re-saving an unchanged chat. */
export function recordSignature(rec) {
  let h = 2166136261;
  const feed = (s) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  };
  feed(rec.title);
  for (const m of rec.messages) feed(`${m.role}\u0001${m.text}\u0002`);
  if (rec.saved) feed(`\u0003${JSON.stringify(rec.saved)}`); // a changed note must count as a change (re-save, re-index)
  return `${rec.messages.length}:${(h >>> 0).toString(36)}`;
}
