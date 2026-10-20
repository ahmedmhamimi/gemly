/**
 * Sanitizers for everything read from chrome.storage.
 *
 * Stored data can be stale (older schema), hand-edited, truncated, or written
 * by a buggy build. Every read goes through the matching sanitizer so the
 * rest of the code can trust its shape: wrong types are coerced or dropped,
 * strings are clamped, folder cycles are broken, depth is capped.
 * All sanitizers are pure and never throw.
 */
import { CONFIG } from './config.js';
import { cleanLabel } from '../util/text.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');
const HEX = /^#[0-9a-f]{6}$/i;
const ID = /^[\w.:-]{1,80}$/;

export const sanitizeFolders = (raw) => {
  if (!Array.isArray(raw)) return [];
  const { palette, maxDepth, maxNameLength } = CONFIG.folders;
  const seen = new Set();
  const out = [];
  for (const f of raw) {
    if (!isObj(f) || !ID.test(str(f.id)) || seen.has(f.id)) continue;
    seen.add(f.id);
    const folder = {
      id: f.id,
      name: cleanLabel(f.name, maxNameLength) || 'Folder',
      color: HEX.test(str(f.color)) ? f.color.toLowerCase() : palette[0].hex,
    };
    if (ID.test(str(f.parentId)) && f.parentId !== f.id) folder.parentId = f.parentId;
    out.push(folder);
  }
  // Orphans (parent missing) become roots.
  const ids = new Set(out.map((f) => f.id));
  out.forEach((f) => {
    if (f.parentId && !ids.has(f.parentId)) delete f.parentId;
  });
  // Break cycles and over-deep chains: walk up from every folder.
  const byId = new Map(out.map((f) => [f.id, f]));
  out.forEach((f) => {
    const chain = new Set([f.id]);
    let cur = f;
    let depth = 0;
    while (cur.parentId) {
      const parent = byId.get(cur.parentId);
      if (!parent || chain.has(parent.id) || ++depth >= maxDepth) {
        delete cur.parentId; // detach at the offending link
        break;
      }
      chain.add(parent.id);
      cur = parent;
    }
  });
  return out;
};

export const sanitizeAssignments = (raw) => {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [convId, folderId] of Object.entries(raw)) {
    if (ID.test(convId) && ID.test(str(folderId))) out[convId] = folderId;
  }
  return out;
};

export const sanitizeConvMeta = (raw) => {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [id, m] of Object.entries(raw)) {
    if (!ID.test(id) || !isObj(m)) continue;
    const path = str(m.path);
    out[id] = {
      title: cleanLabel(m.title, 200),
      // Only same-origin absolute paths are ever navigated to.
      path: path.startsWith('/') && !path.startsWith('//') ? path.slice(0, 300) : null,
    };
  }
  return out;
};

export const sanitizeFolderState = (raw) => {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [id, open] of Object.entries(raw)) if (ID.test(id) && open === true) out[id] = true;
  return out;
};

export const sanitizeTone = (raw) => {
  const base = { selectedId: 'none', customTones: [] };
  if (!isObj(raw)) return base;
  const seen = new Set(CONFIG.tone.presets.map((p) => p.id));
  const customTones = [];
  for (const t of Array.isArray(raw.customTones) ? raw.customTones : []) {
    if (!isObj(t) || !ID.test(str(t.id)) || seen.has(t.id)) continue;
    const label = cleanLabel(t.label, CONFIG.tone.maxCustomLength);
    if (!label) continue;
    seen.add(t.id);
    customTones.push({ id: t.id, label, emoji: '' });
  }
  const selectedId = seen.has(raw.selectedId) ? raw.selectedId : 'none';
  return { selectedId, customTones };
};

export const sanitizeToneLast = (raw) => {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [convId, toneId] of Object.entries(raw)) if (ID.test(convId) && ID.test(str(toneId))) out[convId] = toneId;
  return out;
};

/** A short free-text note: newlines kept, control characters removed, <= 500 chars. */
export const cleanNote = (v) =>
  typeof v === 'string'
    ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 500)
    : '';

export const sanitizeBookmarks = (raw) => {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [convId, list] of Object.entries(raw)) {
    if (!ID.test(convId) || !Array.isArray(list)) continue;
    const seen = new Set();
    const items = [];
    for (const b of list) {
      if (!isObj(b) || typeof b.key !== 'string' || !b.key || seen.has(b.key)) continue;
      seen.add(b.key);
      items.push({
        key: b.key.slice(0, 120),
        role: b.role === 'user' ? 'user' : 'assistant',
        snippet: cleanLabel(b.snippet, CONFIG.bookmarks.snippetLength + 2),
        ...(cleanNote(b.note) ? { note: cleanNote(b.note) } : {}),
        addedAt: Number.isFinite(b.addedAt) ? b.addedAt : 0,
      });
      if (items.length >= CONFIG.bookmarks.maxPerConversation) break;
    }
    if (items.length) out[convId] = items;
  }
  return out;
};

/** `null` means "never saved" (so defaults get seeded once); [] means "deleted all". */
export const sanitizePrompts = (raw) => {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const { maxTitleLength, maxContentLength } = CONFIG.prompts;
  const seen = new Set();
  const out = [];
  for (const p of raw) {
    if (!isObj(p) || !ID.test(str(p.id)) || seen.has(p.id)) continue;
    const content = str(p.content).slice(0, maxContentLength);
    if (!content.trim()) continue;
    seen.add(p.id);
    const steps = Array.isArray(p.steps)
      ? p.steps.filter((t) => typeof t === 'string' && t.trim()).slice(0, MAX_CHAIN_STEPS).map((t) => t.slice(0, maxContentLength))
      : [];
    out.push({
      id: p.id,
      title: cleanLabel(p.title, maxTitleLength),
      content,
      // Follow-up steps of a prompt chain (step 1 is `content`). Absent for ordinary prompts.
      ...(steps.length ? { steps } : {}),
      createdAt: Number.isFinite(p.createdAt) ? p.createdAt : 0,
    });
  }
  return out;
};

export const MAX_CHAIN_STEPS = 9;

const PERSONA = { name: 60, text: 8000, items: 50 };

/**
 * Personas (custom-instruction profiles): `{ items: [{ id, name, text, createdAt }], activeId, autoSend }`.
 * `activeId` is the last applied persona (shown in the quick switcher), `autoSend` whether applying one
 * also sends the first message.
 */
export const sanitizePersonas = (raw) => {
  const out = { items: [], activeId: null, autoSend: false };
  if (!isObj(raw)) return out;
  const seen = new Set();
  for (const p of Array.isArray(raw.items) ? raw.items : []) {
    if (!isObj(p) || !ID.test(str(p.id)) || seen.has(p.id)) continue;
    const text = str(p.text).slice(0, PERSONA.text);
    if (!text.trim()) continue;
    seen.add(p.id);
    out.items.push({ id: p.id, name: cleanLabel(p.name, PERSONA.name) || cleanLabel(text, 30) || 'Persona', text, createdAt: Number.isFinite(p.createdAt) ? p.createdAt : 0 });
    if (out.items.length >= PERSONA.items) break;
  }
  out.activeId = typeof raw.activeId === 'string' && seen.has(raw.activeId) ? raw.activeId : null;
  out.autoSend = raw.autoSend === true;
  return out;
};

/**
 * `{ [featureId]: false }`. Only explicit `false` is kept: an override can only
 * switch a feature OFF (core/feature-registry.js), so `true` carries no
 * information. Unknown ids are kept so a downgrade/upgrade round-trip does not
 * lose a switch the person set for a feature this build does not know.
 */
export const sanitizeFeatureFlags = (raw) => {
  const out = {};
  if (!isObj(raw)) return out;
  let n = 0;
  for (const [id, v] of Object.entries(raw)) {
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(id) || v !== false) continue;
    out[id] = false;
    if (++n >= 200) break;
  }
  return out;
};

const TAG_MAX = 30;
const TAGS_PER_CHAT = 10;
const MAX_ENTRIES = 20000;

/** One tag: trimmed, no commas/newlines, <= 30 chars. Returns '' when unusable. */
export const cleanTag = (t) => cleanLabel(String(t ?? '').replace(/[,\n\r#]+/g, ' '), TAG_MAX);

/** `{ [convId]: string[] }`: tags de-duplicated case-insensitively, at most 10 per chat. */
export const sanitizeChatTags = (raw) => {
  const out = {};
  if (!isObj(raw)) return out;
  let n = 0;
  for (const [id, list] of Object.entries(raw)) {
    if (!ID.test(id) || !Array.isArray(list)) continue;
    const seen = new Set();
    const tags = [];
    for (const t of list) {
      if (typeof t !== 'string') continue;
      const c = cleanTag(t);
      const k = c.toLowerCase();
      if (!c || seen.has(k)) continue;
      seen.add(k);
      tags.push(c);
      if (tags.length >= TAGS_PER_CHAT) break;
    }
    if (tags.length) out[id] = tags;
    if (++n >= MAX_ENTRIES) break;
  }
  return out;
};

/** `{ [convId]: { at, title, path } }` for chats hidden inside the extension. */
export const sanitizeArchived = (raw) => {
  const out = {};
  if (!isObj(raw)) return out;
  let n = 0;
  for (const [id, m] of Object.entries(raw)) {
    if (!ID.test(id) || !isObj(m)) continue;
    const path = str(m.path);
    out[id] = {
      at: Number.isFinite(m.at) ? m.at : 0,
      title: cleanLabel(m.title, 200),
      path: path.startsWith('/') && !path.startsWith('//') ? path.slice(0, 300) : null,
    };
    if (++n >= MAX_ENTRIES) break;
  }
  return out;
};

const HIGHLIGHTS_PER_CHAT = 200;
const QUOTE_MAX = 600;

/**
 * Text highlights: `{ [convId]: [{ id, key, quote, occ, note, createdAt }] }`.
 * `key` identifies the message (same scheme as bookmarks), `quote` is the highlighted
 * text, `occ` which occurrence of the quote inside that message (0-based).
 */
export const sanitizeHighlights = (raw) => {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [convId, list] of Object.entries(raw)) {
    if (!ID.test(convId) || !Array.isArray(list)) continue;
    const seen = new Set();
    const items = [];
    for (const h of list) {
      if (!isObj(h) || !ID.test(str(h.id)) || seen.has(h.id) || typeof h.key !== 'string' || !h.key) continue;
      const quote = str(h.quote).replace(/\s+/g, ' ').trim().slice(0, QUOTE_MAX);
      if (!quote) continue;
      seen.add(h.id);
      items.push({
        id: h.id,
        key: h.key.slice(0, 120),
        quote,
        occ: Number.isInteger(h.occ) && h.occ >= 0 && h.occ < 1000 ? h.occ : 0,
        ...(cleanNote(h.note) ? { note: cleanNote(h.note) } : {}),
        createdAt: Number.isFinite(h.createdAt) ? h.createdAt : 0,
      });
      if (items.length >= HIGHLIGHTS_PER_CHAT) break;
    }
    if (items.length) out[convId] = items;
  }
  return out;
};

export const SUMMARY_LIMITS = Object.freeze({ prompt: 4000, intro: 1000, hintMin: 30, hintMax: 95, hintDefault: 70, handoff: 60000, handoffTtlMs: 120000 });

/** `{ prompt, intro, hintAt }`. Empty prompt / intro mean "use the localized default". */
export const sanitizeSummary = (raw) => {
  const r = isObj(raw) ? raw : {};
  const hint = Number.isFinite(r.hintAt) ? Math.round(r.hintAt) : SUMMARY_LIMITS.hintDefault;
  return {
    prompt: str(r.prompt).slice(0, SUMMARY_LIMITS.prompt),
    intro: str(r.intro).slice(0, SUMMARY_LIMITS.intro),
    hintAt: Math.min(SUMMARY_LIMITS.hintMax, Math.max(SUMMARY_LIMITS.hintMin, hint)),
  };
};

/** `{ text, at }` or null. Stale handoffs (older than the TTL) are dropped when read. */
export const sanitizeHandoff = (raw) => {
  if (!isObj(raw) || typeof raw.text !== 'string' || !raw.text.trim() || !Number.isFinite(raw.at)) return null;
  return { text: raw.text.slice(0, SUMMARY_LIMITS.handoff), at: raw.at };
};
