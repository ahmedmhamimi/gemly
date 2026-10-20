/**
 * Reads the live Gemini conversation and converts each reply's rendered
 * markdown into SANITIZED, semantic HTML for the PDF / JSON / text exporters.
 * Only a whitelist of tags is ever emitted; everything else is flattened to
 * escaped text, so nothing from the page can inject markup into exports.
 */
import { GeminiHost as host } from '../../host/gemini.js';
import { savedForChat } from '../saved/model.js';
import { escapeHtml } from '../../util/text.js';
import { isNoiseNode } from '../../util/plaintext.js';

const INLINE_PASSTHROUGH = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'del', 'sub', 'sup', 'mark']);
const SAFE_HREF = /^(https?:|mailto:|#)/i;

/**
 * `saved`: the person's starred messages and highlights for this chat (with notes), so every
 * exporter can include them.
 * @returns {{ title: string, messages: {role:'user'|'assistant', content:string, isHTML:boolean}[], saved?: object }}
 */
export function extractConversation() {
  const messages = [];
  for (const turn of host.turns()) {
    if (host.isUserTurn(turn)) {
      const text = host.userText(turn);
      if (text) messages.push({ role: 'user', content: text, isHTML: false });
    } else {
      const root = host.assistantRoot(turn);
      const html = root ? renderBlocks(root) : '';
      if (html) messages.push({ role: 'assistant', content: html, isHTML: true });
    }
  }
  const id = host.currentConversationId();
  const saved = id ? savedForChat(id) : null;
  return { title: host.title(), messages, ...(saved ? { saved } : {}) };
}

export function renderBlocks(el) {
  let html = '';
  el.childNodes.forEach((child) => {
    html += renderNode(child);
  });
  return html;
}

function inline(node) {
  let out = '';
  node.childNodes.forEach((c) => {
    out += inlineNode(c);
  });
  return out;
}

function inlineNode(n) {
  if (n.nodeType === Node.TEXT_NODE) return escapeHtml(n.textContent);
  if (n.nodeType !== Node.ELEMENT_NODE || isNoiseNode(n)) return '';
  if (n.dataset && n.dataset.math !== undefined) return `<code class="inline-code">${escapeHtml(n.dataset.math)}</code>`;

  const tag = n.tagName.toLowerCase();
  if (INLINE_PASSTHROUGH.has(tag)) return `<${tag}>${inline(n)}</${tag}>`;
  switch (tag) {
    case 'code':
      return `<code class="inline-code">${escapeHtml(n.textContent)}</code>`;
    case 'br':
      return '<br>';
    case 'a': {
      const href = n.getAttribute('href') || '';
      return SAFE_HREF.test(href) ? `<a href="${escapeHtml(href)}">${inline(n)}</a>` : inline(n);
    }
    case 'p':
    case 'div':
      return inline(n) + (n.nextElementSibling ? '<br>' : '');
    default:
      return inline(n);
  }
}

function codeBlock(node) {
  const pre = node.tagName.toLowerCase() === 'pre' ? node : node.querySelector('pre');
  const codeEl = (pre || node).querySelector?.('code') || pre || node;
  const lang =
    node.querySelector?.('.code-block-decoration span')?.textContent?.trim() ||
    (codeEl.className || '').match?.(/language-([\w+-]+)/)?.[1] ||
    '';
  return (
    '<div class="code-block">' +
    (lang ? `<div class="code-header">${escapeHtml(lang)}</div>` : '') +
    `<pre><code>${escapeHtml(codeEl.textContent.replace(/\s+$/, ''))}</code></pre></div>`
  );
}

function renderNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent.trim();
    return text ? `<p>${escapeHtml(text)}</p>` : '';
  }
  if (node.nodeType !== Node.ELEMENT_NODE || isNoiseNode(node)) return '';

  if (node.dataset && node.dataset.math !== undefined) {
    return node.classList.contains('math-block')
      ? `<div class="code-block"><pre><code>${escapeHtml(node.dataset.math)}</code></pre></div>`
      : `<p>${inlineNode(node)}</p>`;
  }

  const tag = node.tagName.toLowerCase();
  switch (tag) {
    case 'p': case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
      const inner = inline(node);
      return inner.trim() ? `<${tag}>${inner}</${tag}>` : '';
    }
    case 'hr':
      return '<hr>';
    case 'blockquote':
      return `<blockquote>${renderBlocks(node)}</blockquote>`;
    case 'ul':
    case 'ol': {
      let items = '';
      Array.from(node.children).forEach((li) => {
        if (li.tagName.toLowerCase() !== 'li') return;
        let body = '';
        li.childNodes.forEach((c) => {
          const t = c.tagName?.toLowerCase();
          body += t === 'ul' || t === 'ol' ? renderNode(c) : inlineNode(c);
        });
        items += `<li>${body}</li>`;
      });
      return `<${tag}>${items}</${tag}>`;
    }
    case 'table': {
      let rows = '';
      node.querySelectorAll('tr').forEach((tr) => {
        let cells = '';
        tr.querySelectorAll('th, td').forEach((cell) => {
          const ct = cell.tagName.toLowerCase();
          cells += `<${ct}>${inline(cell)}</${ct}>`;
        });
        rows += `<tr>${cells}</tr>`;
      });
      return `<table>${rows}</table>`;
    }
    case 'pre':
    case 'code-block':
      return codeBlock(node);
    case 'img':
      return '';
    default:
      return renderBlocks(node); // wrappers (div, table-block, …): descend
  }
}
