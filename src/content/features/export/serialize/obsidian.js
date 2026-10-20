/**
 * Obsidian-friendly Markdown (pure): YAML front matter + wikilink-safe names.
 *
 * Obsidian resolves [[links]] by file BASENAME, and `# ^ [ ] |` plus the usual
 * path characters break links, so names are cleaned and made unique across the
 * whole vault (not just per folder).
 */
import { recordToMarkdown } from './documents.js';

const FORBIDDEN = /[#^[\]|\\/:*?"<>\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** Wikilink-safe note name (no extension). */
export function noteName(title, fallback = 'Chat', max = 100) {
  let s = String(title ?? '').replace(FORBIDDEN, ' ').replace(/\s+/g, ' ').trim();
  s = Array.from(s).slice(0, max).join('').trim().replace(/^[.\s]+|[.\s]+$/g, '');
  return !s || WINDOWS_RESERVED.test(s) ? fallback : s;
}

/** Chain of folder names for a conversation id (root -> leaf). Pure. */
export function folderPathOf(convId, { folders, assignments }) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out = [];
  let cur = byId.get(assignments[convId]);
  for (let guard = 0; cur && guard < 16; guard++) {
    out.unshift(cur.name);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out;
}

/** Unique basenames (case-insensitive), "Name", "Name (2)", … @param {string[]} names */
export function uniqueNames(names) {
  const used = new Set();
  return names.map((n) => {
    let out = n;
    for (let i = 2; used.has(out.toLowerCase()); i++) out = `${n} (${i})`;
    used.add(out.toLowerCase());
    return out;
  });
}

/** An Obsidian tag: letters/digits/_-/ only, no spaces, not purely numeric. */
export function tagOf(label) {
  const t = String(label ?? '').toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_/-]/gu, '').replace(/^[-/]+|[-/]+$/g, '');
  return !t || /^\d+$/.test(t) ? '' : t;
}

const yamlStr = (s) => JSON.stringify(String(s ?? '')); // JSON strings are valid YAML double-quoted scalars

export function frontMatter({ title, id, url, exportedAt, capturedAt, folders = [], messages }) {
  const tags = [...new Set(['gemly', ...folders.map(tagOf)].filter(Boolean))];
  const lines = ['---', `title: ${yamlStr(title)}`, `conversation_id: ${yamlStr(id)}`];
  if (url) lines.push(`url: ${yamlStr(url)}`);
  if (capturedAt) lines.push(`captured: ${new Date(capturedAt).toISOString()}`);
  if (exportedAt) lines.push(`exported: ${exportedAt}`);
  if (folders.length) lines.push(`folder: ${yamlStr(folders.join(' / '))}`);
  lines.push(`messages: ${messages}`, `tags: [${tags.join(', ')}]`, '---');
  return lines.join('\n');
}

/**
 * @param {object} rec ChatRecord
 * @param {{ labels: {user:string, assistant:string}, folders?: string[], origin?: string, exportedAt?: string }} opts
 */
export function recordToObsidian(rec, { labels, folders = [], origin = '', exportedAt = '' }) {
  const fm = frontMatter({
    title: rec.title, id: rec.id, url: origin && rec.path ? origin + rec.path : '', exportedAt, capturedAt: rec.capturedAt, folders, messages: rec.messages.length,
  });
  // The file name is the title in Obsidian, so no H1; roles become level-2 headings.
  const body = recordToMarkdown(rec, { labels, level: 1 }).replace(/^# .*\n\n/, '');
  return `${fm}\n\n${body}`;
}
