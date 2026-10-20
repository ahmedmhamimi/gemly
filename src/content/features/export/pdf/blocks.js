/**
 * Conversation -> a flat list of PDF "blocks".
 *
 * A block is the smallest unit the paginator moves around: it is never split
 * across a page unless it is itself taller than a page. Messages are split
 * into fine-grained blocks (one per paragraph / list / table / code block) so
 * page breaks land between elements instead of through a line of text, and so
 * no single block can ever exceed a safe canvas size: very long code blocks
 * and tables are split into parts, long user messages into line groups.
 */
import { CONFIG, HOST_NAME } from '../../../core/config.js';
import { Lang } from '../../../i18n/index.js';
import { escapeHtml } from '../../../util/text.js';

const { maxCodeLinesPerPart, maxTableRowsPerPart } = CONFIG.pdf;
const USER_LINES_PER_PART = 60;

/**
 * @typedef {{ html: string, kind: 'header'|'message'|'footer' }} Block
 * @param {{ title: string, messages: {role:string, content:string, isHTML:boolean}[] }} conversation
 * @returns {Block[]}
 */
export function buildBlocks(conversation) {
  const blocks = [];
  const date = new Intl.DateTimeFormat(Lang.locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date());

  blocks.push({
    kind: 'header',
    html:
      `<div class="gl-pdf-header" dir="auto"><div class="gl-pdf-logo">Gemly</div>` +
      `<h1 class="gl-pdf-title">${escapeHtml(conversation.title)}</h1>` +
      `<div class="gl-pdf-subtitle">${escapeHtml(Lang.t('pdf.exportedOn', { date }))} · ` +
      `${escapeHtml(Lang.plural('pdf.messages', conversation.messages.filter((m) => m.heading == null).length))}</div></div>`,
  });

  // Merged documents: optional contents list (titles only; page numbers are not known before rasterising).
  if (conversation.toc?.length) {
    blocks.push({
      kind: 'message',
      html:
        `<div class="gl-pdf-toc" dir="auto"><div class="gl-pdf-toc__title">${escapeHtml(Lang.t('merge.toc'))}</div>` +
        `<ol>${conversation.toc.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ol></div>`,
    });
  }

  for (const msg of conversation.messages) {
    // A section heading that opens each merged chat.
    if (msg.heading != null) {
      blocks.push({ kind: 'message', html: `<h2 class="gl-pdf-section" dir="auto">${escapeHtml(msg.heading)}</h2>` });
      continue;
    }
    const parts = msg.isHTML ? splitHtml(msg.content) : splitPlain(msg.content);
    if (!parts.length) parts.push('<p></p>');
    const label = msg.role === 'user' ? Lang.t('pdf.you') : HOST_NAME;
    parts.forEach((part, i) => {
      const first = i === 0;
      const last = i === parts.length - 1;
      blocks.push({
        kind: 'message',
        html:
          `<div class="gl-pdf-msg gl-pdf-${msg.role}${first ? ' is-first' : ''}${last ? ' is-last' : ''}" dir="auto">` +
          (first ? `<div class="gl-pdf-role"><span class="gl-pdf-dot"></span>${escapeHtml(label)}</div>` : '') +
          `<div class="gl-pdf-content">${part}</div></div>`,
      });
    });
  }

  blocks.push({
    kind: 'footer',
    html:
      `<div class="gl-pdf-footer">${escapeHtml(Lang.t('pdf.exportedWith', { brand: 'Gemly' }))} · ${new Date().getFullYear()}</div>`,
  });
  // The person's own starred messages and highlights, with notes (single chats; merged documents carry none).
  if (conversation.saved) {
    const note = (n) => (n ? `<div class="gl-pdf-saved__note">${escapeHtml(Lang.t('saved.note'))}: ${escapeHtml(n)}</div>` : '');
    const items = [
      ...conversation.saved.bookmarks.map((b) => `<li>★ ${escapeHtml(b.snippet)}${note(b.note)}</li>`),
      ...conversation.saved.highlights.map((h) => `<li><em>“${escapeHtml(h.quote)}”</em>${note(h.note)}</li>`),
    ];
    blocks.push({ kind: 'message', html: `<div class="gl-pdf-saved" dir="auto"><div class="gl-pdf-toc__title">${escapeHtml(Lang.t('saved.title'))}</div><ul>${items.join('')}</ul></div>` });
  }
  return blocks;
}

function splitPlain(text) {
  const lines = String(text || '').split('\n');
  const parts = [];
  for (let i = 0; i < lines.length; i += USER_LINES_PER_PART) {
    parts.push(`<p>${lines.slice(i, i + USER_LINES_PER_PART).map(escapeHtml).join('<br>')}</p>`);
  }
  return parts;
}

/** Split sanitized assistant HTML (see extractor.js) into per-element parts. */
function splitHtml(html) {
  const box = document.createElement('div');
  box.innerHTML = html;
  const parts = [];
  for (const el of box.children) {
    if (el.classList.contains('code-block')) parts.push(...splitCode(el));
    else if (el.tagName === 'TABLE') parts.push(...splitTable(el));
    else parts.push(el.outerHTML);
  }
  return parts;
}

function splitCode(block) {
  const header = block.querySelector('.code-header')?.outerHTML || '';
  const lines = (block.querySelector('code')?.textContent || '').split('\n');
  if (lines.length <= maxCodeLinesPerPart) return [block.outerHTML];
  const out = [];
  for (let i = 0; i < lines.length; i += maxCodeLinesPerPart) {
    const slice = lines.slice(i, i + maxCodeLinesPerPart).join('\n');
    out.push(`<div class="code-block">${i === 0 ? header : ''}<pre><code>${escapeHtml(slice)}</code></pre></div>`);
  }
  return out;
}

function splitTable(table) {
  const rows = [...table.rows];
  if (rows.length <= maxTableRowsPerPart) return [table.outerHTML];
  const headRow = rows[0] && rows[0].querySelector('th') ? rows[0].outerHTML : '';
  const body = headRow ? rows.slice(1) : rows;
  const out = [];
  for (let i = 0; i < body.length; i += maxTableRowsPerPart) {
    out.push(`<table>${headRow}${body.slice(i, i + maxTableRowsPerPart).map((r) => r.outerHTML).join('')}</table>`);
  }
  return out;
}
