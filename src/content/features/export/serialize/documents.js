/**
 * Whole-document serializers (pure): Markdown and standalone HTML for one or
 * many ChatRecords. Role labels are passed in (they are localised by the caller).
 */
import { escapeMarkdown, escapeText, toMarkdown } from './markup.js';

/**
 * @typedef {{ user: string, assistant: string, saved?: string, note?: string }} Labels
 * `saved` / `note` title the "Saved items" section; they fall back to English when a caller passes only roles.
 */

const quote = (text) => text.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');

/** One chat as Markdown (no front matter; see obsidian.js for that). */
export function recordToMarkdown(rec, { labels, level = 1, title = rec.title } = {}) {
  const h = (n) => '#'.repeat(Math.min(6, n));
  const out = [`${h(level)} ${title.replace(/\n/g, ' ')}`];
  for (const m of rec.messages) {
    out.push(`${h(level + 1)} ${m.role === 'user' ? labels.user : labels.assistant}`);
    out.push(m.role === 'user' || !m.html ? quote(m.text) : toMarkdown(m.html) || m.text);
  }
  if (rec.saved) out.push(`${h(level + 1)} ${labels.saved || 'Saved'}`, savedMarkdown(rec.saved, labels));
  return `${out.join('\n\n')}\n`;
}

/** Starred messages and highlights, each with its note (pure). */
export function savedMarkdown(saved, labels = {}) {
  const noteLabel = labels.note || 'Note';
  const lines = [];
  const note = (n) => (n ? [`  - *${noteLabel}:* ${escapeMarkdown(n).replace(/\n/g, '\n    ')}`] : []);
  for (const b of saved.bookmarks) lines.push(`- ★ ${escapeMarkdown(b.snippet)}`, ...note(b.note));
  for (const h of saved.highlights) lines.push(`- *“${escapeMarkdown(h.quote)}”*`, ...note(h.note));
  return lines.join('\n');
}

const CSS = `
:root{color-scheme:light dark;--bg:#fff;--fg:#14161c;--mut:#565a67;--card:#f5f6fa;--bd:#e3e5ee;--acc:#5468ff}
@media(prefers-color-scheme:dark){:root{--bg:#16171b;--fg:#f1f2f6;--mut:#a7aab6;--card:#202127;--bd:#34353d;--acc:#8fa0ff}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:820px;margin:0 auto;padding:32px 20px 80px}
h1.doc{font-size:1.8rem;margin:.2em 0 .1em}.meta{color:var(--mut);font-size:.85rem;margin-bottom:1.5rem}
section.chat{margin:2.5rem 0;border-top:2px solid var(--bd);padding-top:1rem}
.msg{margin:1.1rem 0;padding:.8rem 1rem;border-radius:12px;background:var(--card);border:1px solid var(--bd)}
.msg.user{border-inline-start:4px solid var(--acc)}.role{font-size:.75rem;letter-spacing:.04em;text-transform:uppercase;color:var(--mut);margin-bottom:.3rem}
.msg p:first-child{margin-top:0}.msg p:last-child{margin-bottom:0}.user .txt{white-space:pre-wrap}
pre{background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:.7rem;overflow:auto}code{font:13px/1.5 ui-monospace,Menlo,Consolas,monospace}
.inline-code{background:var(--bg);padding:.1em .35em;border-radius:5px;border:1px solid var(--bd)}
.code-header{font:600 .72rem system-ui;color:var(--mut);text-transform:uppercase}
table{border-collapse:collapse;display:block;overflow:auto}td,th{border:1px solid var(--bd);padding:.35rem .6rem}blockquote{margin:.6rem 0;padding-inline-start:.9rem;border-inline-start:3px solid var(--bd);color:var(--mut)}
nav.toc ol{padding-inline-start:1.2rem}a{color:var(--acc)}
.saved h3{font-size:1rem;margin:1.2rem 0 .4rem}.saved li{margin:.3rem 0}.saved .note{color:var(--mut);font-size:.9rem;white-space:pre-wrap}
`;

/** Slug that is unique inside one document. */
export function anchorFor(i) {
  return `chat-${i + 1}`;
}

function savedHtml(saved, labels) {
  const note = (n) => (n ? `<div class="note">${escapeText(labels.note || 'Note')}: ${escapeText(n)}</div>` : '');
  const items = [
    ...saved.bookmarks.map((b) => `<li>★ ${escapeText(b.snippet)}${note(b.note)}</li>`),
    ...saved.highlights.map((h) => `<li><em>“${escapeText(h.quote)}”</em>${note(h.note)}</li>`),
  ];
  return `<div class="saved"><h3>${escapeText(labels.saved || 'Saved')}</h3><ul>${items.join('')}</ul></div>`;
}

/**
 * Standalone HTML document (no scripts, no external requests).
 * @param {object[]} records
 * @param {{ title: string, labels: Labels, lang?: string, dir?: 'ltr'|'rtl', toc?: boolean, exportedAt?: string, tocLabel?: string }} opts
 */
export function recordsToHtml(records, { title, labels, lang = 'en', dir = 'ltr', toc = false, exportedAt = '', tocLabel = 'Contents' }) {
  const chats = records
    .map((rec, i) => {
      const msgs = rec.messages
        .map((m) => {
          const body = m.role === 'user' || !m.html ? `<div class="txt">${escapeText(m.text)}</div>` : m.html;
          return `<div class="msg ${m.role}"><div class="role">${escapeText(m.role === 'user' ? labels.user : labels.assistant)}</div>${body}</div>`;
        })
        .join('\n');
      const heading = records.length > 1 || toc ? `<h2 id="${anchorFor(i)}">${escapeText(rec.title)}</h2>` : '';
      return `<section class="chat" dir="auto">${heading}\n${msgs}${rec.saved ? `\n${savedHtml(rec.saved, labels)}` : ''}</section>`;
    })
    .join('\n');
  const nav =
    toc && records.length > 1
      ? `<nav class="toc"><strong>${escapeText(tocLabel)}</strong><ol>${records.map((r, i) => `<li><a href="#${anchorFor(i)}">${escapeText(r.title)}</a></li>`).join('')}</ol></nav>`
      : '';
  return (
    `<!doctype html>\n<html lang="${escapeText(lang)}" dir="${dir}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeText(title)}</title>` +
    `<style>${CSS}</style></head><body><main><h1 class="doc">${escapeText(title)}</h1>` +
    `${exportedAt ? `<div class="meta">${escapeText(exportedAt)}</div>` : ''}${nav}\n${chats}\n</main></body></html>\n`
  );
}
