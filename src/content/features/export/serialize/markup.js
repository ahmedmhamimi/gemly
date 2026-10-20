/**
 * Pure converter for the HTML that features/export/extractor.js emits.
 *
 * That HTML is a small whitelisted subset (p, h1-6, hr, blockquote, ul/ol/li,
 * table, div.code-block > pre > code, inline emphasis, code, a, br). Because the
 * subset is fixed, a tiny tokenizer replaces a DOM parser, so this module works in
 * the service worker, in tests and in the page alike, and the same tree serves:
 *
 *   parse()          -> tree
 *   sanitizeHtml()   -> re-serialised, whitelist-only HTML. Used on anything that did
 *                       not come from the live page (an imported backup file).
 *   toMarkdown()     -> GitHub-flavoured Markdown
 *   toText()         -> plain text
 *
 * Anything outside the whitelist is flattened to its text; attributes other than
 * `class` (code blocks only) and a safe `href` are dropped. No DOM, no chrome.*.
 */

const VOID = new Set(['br', 'hr']);
const INLINE_KEEP = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'del', 'sub', 'sup', 'mark']);
const BLOCKS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'blockquote', 'ul', 'ol', 'li', 'table', 'tr', 'th', 'td', 'pre', 'div']);
const KNOWN = new Set([...INLINE_KEEP, ...BLOCKS, 'br', 'code', 'a']);
const SAFE_HREF = /^(https?:|mailto:|#)/i;
const MAX_DEPTH = 40;

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': '\u00a0' };
const unescapeHtml = (s) => s.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m]);
export const escapeText = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const VALUE = `(?:"[^"]*"|'[^']*'|[^\\s"'>/]+)`;
const TOKEN = new RegExp(`<(\\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\\s+[a-zA-Z-]+(?:=${VALUE})?)*)\\s*(\\/?)>|([^<]+)|(<)`, 'g');
const ATTR = /([a-zA-Z-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+)))?/g;

/** @returns {{ tag: string, attrs: Record<string,string>, children: any[] }} root */
export function parse(html) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const str = String(html ?? '');
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(str); m; m = TOKEN.exec(str)) {
    if (m[5] !== undefined) {
      top().children.push(unescapeHtml(m[5]));
    } else if (m[6]) {
      top().children.push('<'); // a stray "<" that is not a tag
    } else {
      const closing = m[1] === '/';
      const tag = m[2].toLowerCase();
      if (closing) {
        for (let i = stack.length - 1; i > 0; i--) {
          if (stack[i].tag === tag) {
            stack.length = i;
            break;
          }
        }
        continue;
      }
      const attrs = {};
      for (let a = ATTR.exec(m[3]); a; a = ATTR.exec(m[3])) attrs[a[1].toLowerCase()] = unescapeHtml(a[2] ?? a[3] ?? a[4] ?? '');
      ATTR.lastIndex = 0;
      const node = { tag, attrs, children: [] };
      top().children.push(node);
      if (!VOID.has(tag) && !m[4] && stack.length < MAX_DEPTH) stack.push(node);
    }
  }
  return root;
}

const hasClass = (n, c) => (n.attrs.class || '').split(/\s+/).includes(c);
const textOf = (n) => (typeof n === 'string' ? n : n.children.map(textOf).join(''));

// ------------------------------------------------------------------ sanitizer

function serializeNode(n, depth = 0) {
  if (typeof n === 'string') return escapeText(n);
  if (depth > MAX_DEPTH) return '';
  const inner = () => n.children.map((c) => serializeNode(c, depth + 1)).join('');
  const { tag } = n;
  if (!KNOWN.has(tag)) return inner(); // unknown tag (script, img, iframe…): keep only its text
  if (tag === 'script' || tag === 'style') return '';
  if (tag === 'br' || tag === 'hr') return `<${tag}>`;
  if (tag === 'a') {
    const href = n.attrs.href || '';
    return SAFE_HREF.test(href) ? `<a href="${escapeText(href)}">${inner()}</a>` : inner();
  }
  if (tag === 'code') return hasClass(n, 'inline-code') ? `<code class="inline-code">${inner()}</code>` : `<code>${inner()}</code>`;
  if (tag === 'div') {
    if (hasClass(n, 'code-block')) return `<div class="code-block">${inner()}</div>`;
    if (hasClass(n, 'code-header')) return `<div class="code-header">${inner()}</div>`;
    return inner();
  }
  return `<${tag}>${inner()}</${tag}>`;
}

/** Whitelist-only HTML. Drops <script>/<style> together with their content. */
export function sanitizeHtml(html) {
  const tree = parse(html);
  const strip = (n) => {
    if (typeof n === 'string') return n;
    if (n.tag === 'script' || n.tag === 'style') return '';
    n.children = n.children.map(strip).filter((c) => c !== '');
    return n;
  };
  return serializeNode(strip(tree)).trim();
}

// ------------------------------------------------------------------- markdown

export const escapeMarkdown = (s) => escMd(s);

const escMd = (s) =>
  s
    .replace(/\\/g, '\\\\')
    .replace(/([*`<[\]])/g, '\\$1')
    .replace(/(^|\s)_|_(?=\s|$)/g, (m) => m.replace('_', '\\_'));

function codeSpan(text) {
  const t = text.replace(/\n/g, ' ');
  const run = Math.max(0, ...(t.match(/`+/g) || []).map((x) => x.length));
  const fence = '`'.repeat(run + 1);
  return `${fence}${t.startsWith('`') || t.endsWith('`') ? ` ${t} ` : t}${fence}`;
}

function inlineMd(n) {
  if (typeof n === 'string') return escMd(n);
  const inner = () => n.children.map(inlineMd).join('');
  switch (n.tag) {
    case 'strong': case 'b': return wrap('**', inner());
    case 'em': case 'i': return wrap('*', inner());
    case 's': case 'del': return wrap('~~', inner());
    case 'code': return codeSpan(textOf(n));
    case 'br': return '  \n';
    case 'a': {
      const href = n.attrs.href || '';
      const label = inner();
      return SAFE_HREF.test(href) && label ? `[${label}](${href.replace(/[()\s]/g, (c) => encodeURIComponent(c))})` : label;
    }
    case 'sub': case 'sup': case 'u': case 'mark': return `<${n.tag}>${inner()}</${n.tag}>`;
    default: return inner();
  }
}
const wrap = (mark, s) => (s.trim() ? `${s.match(/^\s*/)[0]}${mark}${s.trim()}${mark}${s.match(/\s*$/)[0]}` : s);

function codeBlockMd(n) {
  const header = n.children.find((c) => typeof c !== 'string' && hasClass(c, 'code-header'));
  const lang = header ? textOf(header).trim().toLowerCase().replace(/[^a-z0-9+#.-]/g, '') : '';
  const code = textOf({ children: n.children.filter((c) => c !== header) }).replace(/\n+$/, '');
  const run = Math.max(2, ...(code.match(/`{3,}/g) || []).map((x) => x.length));
  const fence = '`'.repeat(run + 1);
  return `${fence}${lang}\n${code}\n${fence}`;
}

function listMd(n, indent) {
  const ordered = n.tag === 'ol';
  let i = 0;
  return n.children
    .filter((c) => typeof c !== 'string' && c.tag === 'li')
    .map((li) => {
      const marker = ordered ? `${++i}. ` : '- ';
      const pad = ' '.repeat(marker.length);
      const own = li.children.filter((c) => typeof c === 'string' || (c.tag !== 'ul' && c.tag !== 'ol'));
      const nested = li.children.filter((c) => typeof c !== 'string' && (c.tag === 'ul' || c.tag === 'ol'));
      let line = indent + marker + own.map(inlineMd).join('').trim().replace(/\n/g, `\n${indent}${pad}`);
      for (const sub of nested) line += `\n${listMd(sub, indent + pad)}`;
      return line;
    })
    .join('\n');
}

function tableMd(n) {
  const rows = [];
  const walk = (x) => {
    if (typeof x === 'string') return;
    if (x.tag === 'tr') rows.push(x.children.filter((c) => typeof c !== 'string' && (c.tag === 'th' || c.tag === 'td')));
    else x.children.forEach(walk);
  };
  walk(n);
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const cell = (c) => (c ? c.children.map(inlineMd).join('').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim() : '');
  const line = (r) => `| ${Array.from({ length: width }, (_, i) => cell(r[i])).join(' | ')} |`;
  return [line(rows[0]), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
}

function blockMd(n, indent = '') {
  if (typeof n === 'string') return n.trim() ? escMd(n.trim()) : '';
  switch (n.tag) {
    case 'p': return n.children.map(inlineMd).join('').trim();
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
      return `${'#'.repeat(Number(n.tag[1]))} ${n.children.map(inlineMd).join('').trim()}`;
    case 'hr': return '---';
    case 'blockquote': return blocksMd(n.children).split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
    case 'ul': case 'ol': return listMd(n, indent);
    case 'table': return tableMd(n);
    case 'div': return hasClass(n, 'code-block') ? codeBlockMd(n) : blocksMd(n.children);
    case 'pre': return codeBlockMd({ children: [n] });
    default: return inlineMd(n).trim();
  }
}

function blocksMd(children) {
  // Consecutive inline nodes at block level form one paragraph.
  const out = [];
  let run = [];
  const flush = () => {
    const t = run.map(inlineMd).join('').trim();
    if (t) out.push(t);
    run = [];
  };
  for (const c of children) {
    if (typeof c === 'string' || !BLOCKS.has(c.tag)) run.push(c);
    else {
      flush();
      const b = blockMd(c);
      if (b) out.push(b);
    }
  }
  flush();
  return out.join('\n\n');
}

export function toMarkdown(html) {
  return blocksMd(parse(html).children);
}

// ----------------------------------------------------------------- plain text

function textBlocks(children) {
  const out = [];
  let run = '';
  const flush = () => {
    if (run.trim()) out.push(run.trim());
    run = '';
  };
  const inline = (n) => (typeof n === 'string' ? n : n.tag === 'br' ? '\n' : n.children.map(inline).join(''));
  for (const c of children) {
    if (typeof c === 'string' || !BLOCKS.has(c.tag)) {
      run += inline(c);
      continue;
    }
    flush();
    if (c.tag === 'hr') out.push('---');
    else if (c.tag === 'ul' || c.tag === 'ol') {
      let i = 0;
      out.push(c.children.filter((li) => typeof li !== 'string' && li.tag === 'li').map((li) => `${c.tag === 'ol' ? `${++i}.` : '-'} ${textBlocks(li.children).replace(/\n/g, '\n  ')}`).join('\n'));
    } else if (c.tag === 'table') {
      const rows = [];
      const walk = (x) => typeof x !== 'string' && (x.tag === 'tr' ? rows.push(x.children.filter((k) => typeof k !== 'string').map((k) => textOf(k).trim()).join('\t')) : x.children.forEach(walk));
      walk(c);
      out.push(rows.join('\n'));
    } else if (c.tag === 'div' && hasClass(c, 'code-block')) {
      out.push(textOf({ children: c.children.filter((k) => typeof k === 'string' || !hasClass(k, 'code-header')) }).replace(/\n+$/, ''));
    } else out.push(textBlocks(c.children));
  }
  flush();
  return out.join('\n\n');
}

export function toText(html) {
  return textBlocks(parse(html).children);
}

/** Every code block: `[{ lang, code }]` (for the "download all code" feature and the search index). */
export function codeBlocks(html) {
  const found = [];
  const walk = (n) => {
    if (typeof n === 'string') return;
    if (n.tag === 'div' && hasClass(n, 'code-block')) {
      const header = n.children.find((c) => typeof c !== 'string' && hasClass(c, 'code-header'));
      found.push({
        lang: header ? textOf(header).trim() : '',
        code: textOf({ children: n.children.filter((c) => c !== header) }).replace(/\n+$/, ''),
      });
    } else n.children.forEach(walk);
  };
  walk(parse(html));
  return found;
}

/** Every table as `string[][]`. */
export function tables(html) {
  const found = [];
  const walk = (n) => {
    if (typeof n === 'string') return;
    if (n.tag === 'table') {
      const rows = [];
      const rowsOf = (x) => typeof x !== 'string' && (x.tag === 'tr' ? rows.push(x.children.filter((k) => typeof k !== 'string').map((k) => textOf(k).trim())) : x.children.forEach(rowsOf));
      rowsOf(n);
      found.push(rows);
    } else n.children.forEach(walk);
  };
  walk(parse(html));
  return found;
}
