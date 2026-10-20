/**
 * Import / export of the prompt library (pure). The file is portable on purpose:
 * no ids, no timestamps, so it can be shared and merged into any library.
 *
 *   { format: 'gemly-prompts', version: 1, exportedAt, prompts: [{ title, content, steps? }],
 *     personas: [{ name, text }] }
 *
 * Import never trusts the file: every entry goes through the same sanitizers as
 * stored data, bad entries are counted, and duplicates are skipped on merge.
 */
import { sanitizePersonas, sanitizePrompts } from '../../core/schema.js';

export const PROMPTS_FORMAT = 'gemly-prompts';
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ITEMS = 1000;

export function buildExport({ prompts, personas, exportedAt = new Date().toISOString() }) {
  return {
    format: PROMPTS_FORMAT,
    version: 1,
    exportedAt,
    prompts: (prompts || []).map((p) => ({ title: p.title, content: p.content, ...(p.steps?.length ? { steps: p.steps } : {}) })),
    personas: (personas?.items || []).map((p) => ({ name: p.name, text: p.text })),
  };
}

/**
 * @returns {{ ok: true, prompts: object[], personas: object[], skipped: number }
 *          | { ok: false, error: 'empty'|'json'|'format'|'newer'|'size' }}
 */
export function parseImport(text) {
  const src = String(text ?? '').replace(/^\ufeff/, '').trim();
  if (!src) return { ok: false, error: 'empty' };
  if (src.length > MAX_IMPORT_BYTES) return { ok: false, error: 'size' };
  let data;
  try {
    data = JSON.parse(src);
  } catch {
    return { ok: false, error: 'json' };
  }
  if (!data || typeof data !== 'object' || data.format !== PROMPTS_FORMAT) return { ok: false, error: 'format' };
  if (!Number.isInteger(data.version) || data.version > 1) return { ok: false, error: 'newer' };

  const rawPrompts = (Array.isArray(data.prompts) ? data.prompts : []).slice(0, MAX_IMPORT_ITEMS);
  const rawPersonas = (Array.isArray(data.personas) ? data.personas : []).slice(0, MAX_IMPORT_ITEMS);
  // Reuse the stored-data sanitizers by giving every entry a temporary id.
  const prompts = sanitizePrompts(rawPrompts.map((p, i) => ({ ...(p && typeof p === 'object' ? p : {}), id: `imp${i}` }))) || [];
  const personas = sanitizePersonas({ items: rawPersonas.map((p, i) => ({ ...(p && typeof p === 'object' ? p : {}), id: `imp${i}` })) }).items;
  const skipped = rawPrompts.length - prompts.length + (rawPersonas.length - personas.length);
  return {
    ok: true,
    prompts: prompts.map(({ title, content, steps }) => ({ title, content, ...(steps ? { steps } : {}) })),
    personas: personas.map(({ name, text }) => ({ name, text })),
    skipped,
  };
}

const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const promptKey = (p) => [norm(p.title), norm(p.content), ...(p.steps || []).map(norm)].join('\u0001');
const personaKey = (p) => `${norm(p.name)}\u0001${norm(p.text)}`;

/** New prompts first. Identical (title + content + steps) ones are skipped. @returns {{ list: object[], added: number, duplicates: number }} */
export function mergePrompts(existing, incoming, mkId, now = Date.now()) {
  const have = new Set(existing.map(promptKey));
  const fresh = [];
  let duplicates = 0;
  for (const p of incoming) {
    const k = promptKey(p);
    if (have.has(k)) {
      duplicates++;
      continue;
    }
    have.add(k);
    fresh.push({ id: mkId(), title: p.title, content: p.content, ...(p.steps ? { steps: p.steps } : {}), createdAt: now });
  }
  return { list: [...fresh, ...existing], added: fresh.length, duplicates };
}

/** @returns {{ items: object[], added: number, duplicates: number }} (capped at the stored maximum of 50) */
export function mergePersonas(existing, incoming, mkId, now = Date.now(), max = 50) {
  const have = new Set(existing.map(personaKey));
  const items = [...existing];
  let added = 0;
  let duplicates = 0;
  for (const p of incoming) {
    const k = personaKey(p);
    if (have.has(k)) {
      duplicates++;
      continue;
    }
    if (items.length >= max) break;
    have.add(k);
    items.push({ id: mkId(), name: p.name, text: p.text, createdAt: now });
    added++;
  }
  return { items, added, duplicates };
}
