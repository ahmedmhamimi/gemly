/**
 * Rendered message DOM -> clean plain text.
 *
 * Gemini renders markdown into real <strong>/<table>/<code-block> elements
 * client-side, so there is no raw markdown to copy. This walks the rendered
 * tree and produces readable text: no **, #, `, |; "- " bullets, numbered
 * items, "label (url)" links, TeX source for math.
 */

const NOISE_TAGS = new Set([
  'BUTTON', 'MAT-ICON', 'SOURCE-FOOTNOTE', 'SOURCES-CAROUSEL-INLINE', 'SOURCES-CAROUSEL',
  'SOURCE-INLINE-CHIP', 'STYLE', 'SCRIPT', 'SVG', 'IMG', 'CANVAS',
]);

/** Elements that never carry message content (UI chrome, hidden labels). */
export function isNoiseNode(el) {
  if (NOISE_TAGS.has(el.tagName)) return true;
  const cl = el.classList;
  if (cl && (cl.contains('cdk-visually-hidden') || cl.contains('code-header') || cl.contains('code-block-decoration'))) return true;
  return el.hasAttribute?.('hidden') ?? false;
}

export function htmlNodeToPlainText(root) {
  let out = '';

  const walkChildren = (node) => node.childNodes.forEach(walk);
  /** Start a block on its own line (never glued to preceding inline text). */
  const breakLine = () => {
    if (out && !out.endsWith('\n')) out += '\n';
  };

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || isNoiseNode(node)) return;

    // KaTeX: keep the TeX source, drop the rendered glyph soup.
    if (node.dataset && node.dataset.math !== undefined) {
      out += node.dataset.math;
      if (node.classList.contains('math-block')) out += '\n\n';
      return;
    }

    switch (node.tagName) {
      case 'BR':
        out += '\n';
        return;
      case 'HR':
        out += '\n\n';
        return;
      case 'CODE-BLOCK':
      case 'PRE': {
        const pre = node.tagName === 'PRE' ? node : node.querySelector('pre');
        const codeEl = pre?.querySelector('code') || pre || node;
        breakLine();
        out += codeEl.textContent.replace(/\s+$/, '') + '\n\n';
        return;
      }
      case 'CODE': // inline code only - blocks return above
        out += node.textContent;
        return;
      case 'A': {
        const before = out.length;
        walkChildren(node);
        const label = out.slice(before).trim();
        const href = node.getAttribute('href');
        if (href && href !== label && !href.startsWith('#') && !/^javascript:/i.test(href)) {
          out = out.slice(0, before) + label + ` (${href})`;
        }
        return;
      }
      case 'LI': {
        const parent = node.parentElement;
        out += parent?.tagName === 'OL' ? `${Array.prototype.indexOf.call(parent.children, node) + 1}. ` : '- ';
        walkChildren(node);
        breakLine(); // a nested list already ended the line
        return;
      }
      case 'TABLE':
        breakLine();
        node.querySelectorAll('tr').forEach((tr) => {
          out += Array.from(tr.querySelectorAll('th, td'), (c) => c.textContent.trim()).join(' | ') + '\n';
        });
        out += '\n';
        return;
      case 'UL':
      case 'OL':
        breakLine();
        Array.from(node.children).forEach(walk);
        if (!node.closest('li')) out += '\n'; // blank line after a TOP-LEVEL list only
        return;
      case 'P': case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6':
      case 'DIV': case 'BLOCKQUOTE':
        walkChildren(node);
        out += '\n\n';
        return;
      default:
        walkChildren(node);
    }
  }

  walkChildren(root);
  return out
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
