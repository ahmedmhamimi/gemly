/**
 * The off-screen, styled DOM stage html2canvas rasterises. Pure DOM/CSS - no
 * page interaction. Styles are inlined into the stage (not the page CSS) and
 * all class names are `gl-pdf-*`, so Gemini's styles can't affect the output
 * and the output can't leak into Gemini.
 */
import { CONFIG, IDS, OWN } from '../../../core/config.js';

const S = `#${IDS.renderStage}`;

const CSS = `
${S}, ${S} * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Naskh Arabic", "Noto Sans", sans-serif; color: #1d1d1f; }
${S} .gl-pdf-header { text-align: center; padding: 20px 24px 16px; border-bottom: 3px solid #8a6bff; margin: 0 0 16px; }
${S} .gl-pdf-logo { font-size: 26px; font-weight: 700; color: #5468ff; letter-spacing: -0.5px; }
${S} .gl-pdf-title { font-size: 17px; font-weight: 500; margin: 6px 0 3px; word-break: break-word; }
${S} .gl-pdf-subtitle { font-size: 12px; color: #8e8e93; }
${S} .gl-pdf-section { font-size: 20px; font-weight: 600; margin: 26px 4px 4px; padding-bottom: 6px; border-bottom: 2px solid #d6ddff; word-break: break-word; }
${S} .gl-pdf-toc { margin: 4px 4px 8px; padding: 10px 20px; border: 1px solid #e9ecf0; border-radius: 10px; background: #f8f9fb; font-size: 14px; }
${S} .gl-pdf-toc__title { font-size: 11px; font-weight: 700; color: #8e8e93; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 6px; }
${S} .gl-pdf-saved { margin: 18px 4px 4px; padding: 10px 20px; border: 1px solid #f3e3a1; border-radius: 10px; background: #fffbea; font-size: 14px; }
${S} .gl-pdf-saved ul { margin: 0; padding-inline-start: 20px; line-height: 1.6; }
${S} .gl-pdf-saved__note { color: #6b6b72; font-size: 12.5px; white-space: pre-wrap; }
${S} .gl-pdf-toc ol { margin: 0; padding-inline-start: 22px; line-height: 1.7; }

${S} .gl-pdf-msg { margin: 0 4px; padding: 0 20px; border: 1px solid #e9ecf0; border-top-width: 0; border-bottom-width: 0; }
${S} .gl-pdf-msg.is-first { margin-top: 14px; padding-top: 14px; border-top-width: 1px; border-radius: 10px 10px 0 0; }
${S} .gl-pdf-msg.is-last { padding-bottom: 14px; border-bottom-width: 1px; border-radius: 0 0 10px 10px; }
${S} .gl-pdf-msg.is-first.is-last { border-radius: 10px; }
${S} .gl-pdf-user { background: #f1f4ff; border-color: #d6ddff; border-inline-start: 4px solid #5468ff; }
${S} .gl-pdf-assistant { background: #f8f9fb; border-color: #e9ecf0; border-inline-end: 4px solid #9a6bff; }
${S} .gl-pdf-role { font-size: 11px; font-weight: 700; color: #8e8e93; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 6px; }
${S} .gl-pdf-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-inline-end: 6px; }
${S} .gl-pdf-user .gl-pdf-dot { background: #5468ff; }
${S} .gl-pdf-assistant .gl-pdf-dot { background: #9a6bff; }

${S} .gl-pdf-content { font-size: 14px; line-height: 1.6; overflow-wrap: anywhere; }
${S} .gl-pdf-content > *:first-child { margin-top: 0; }
${S} .gl-pdf-content p, ${S} .gl-pdf-content li, ${S} .gl-pdf-content h1, ${S} .gl-pdf-content h2, ${S} .gl-pdf-content h3, ${S} .gl-pdf-content h4, ${S} .gl-pdf-content td, ${S} .gl-pdf-content th { unicode-bidi: plaintext; text-align: start; }
${S} .gl-pdf-content p { margin: 0 0 8px; }
${S} .gl-pdf-content ul, ${S} .gl-pdf-content ol { padding-inline-start: 22px; margin: 6px 0; }
${S} .gl-pdf-content li { margin-bottom: 4px; }
${S} .gl-pdf-content strong { font-weight: 600; }
${S} .gl-pdf-content a { color: #5468ff; text-decoration: underline; word-break: break-all; }
${S} .gl-pdf-content blockquote { margin: 8px 0; padding: 4px 14px; border-inline-start: 3px solid #d0d5dd; color: #4b5563; }
${S} .gl-pdf-content h1, ${S} .gl-pdf-content h2, ${S} .gl-pdf-content h3 { margin: 10px 0 6px; font-weight: 600; }
${S} .gl-pdf-content h1 { font-size: 19px; } ${S} .gl-pdf-content h2 { font-size: 17px; } ${S} .gl-pdf-content h3 { font-size: 15px; }
${S} .gl-pdf-content table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 13px; }
${S} .gl-pdf-content th, ${S} .gl-pdf-content td { border: 1px solid #e5e7eb; padding: 5px 8px; }
${S} .gl-pdf-content th { background: #f3f4f6; font-weight: 600; }
${S} .code-block { background: #1e1e2e; border-radius: 8px; margin: 10px 0; overflow: hidden; direction: ltr; }
${S} .code-header { background: #2d2d44; color: #cdd6f4; font-size: 11px; font-weight: 500; padding: 4px 14px; font-family: Menlo, Consolas, monospace; border-bottom: 1px solid #3d3d55; }
${S} .code-block pre { margin: 0; padding: 12px 16px; white-space: pre-wrap; overflow-wrap: anywhere; background: #1e1e2e; }
${S} .code-block code { font-family: Menlo, Consolas, monospace; font-size: 12px; line-height: 1.5; color: #cdd6f4; white-space: pre-wrap; overflow-wrap: anywhere; }
${S} .inline-code { background: #f0f0f5; padding: 1px 6px; border-radius: 3px; font-family: Menlo, Consolas, monospace; font-size: 13px; color: #d63384; border: 1px solid #e5e5ea; direction: ltr; unicode-bidi: isolate; }
${S} .gl-pdf-footer { text-align: center; padding: 14px 0 6px; margin-top: 10px; border-top: 2px solid #e9ecf0; font-size: 11px; color: #8e8e93; }
`;

/**
 * A throw-away rendering surface. Preferably a hidden same-origin iframe:
 * html2canvas clones the WHOLE document it renders from, so on the real
 * Gemini page (thousands of nodes, big stylesheets) every raster pass would
 * clone all of it; inside an empty iframe it clones only the stage. If the
 * iframe cannot be created (page CSP, sandboxing) the main document is used.
 *
 * @returns {{ doc: Document, mount: HTMLElement, resize: (h:number)=>void, dispose: () => void }}
 */
export function createSurface() {
  try {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('tabindex', '-1');
    iframe.setAttribute('data-gemly-owned', '');
    iframe.style.cssText = `position:fixed;top:0;left:-100000px;width:${CONFIG.pdf.contentWidthPx}px;height:800px;border:0;pointer-events:none;`;
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument;
    if (!doc?.body) throw new Error('no iframe document');
    doc.body.style.cssText = 'margin:0;background:#fff;';
    return {
      doc,
      mount: doc.body,
      resize: (h) => {
        iframe.style.height = `${Math.ceil(h) + 4}px`;
      },
      dispose: () => iframe.remove(),
    };
  } catch {
    return { doc: document, mount: document.body, resize: () => {}, dispose: () => {} };
  }
}

/**
 * @param {{ html: string }[]} blocks
 * @param {Document} [doc] document the stage is built in (see createSurface)
 * @returns {{ root: HTMLElement, elements: HTMLElement[] }} elements[i] is the node for blocks[i]
 */
export function buildStage(blocks, doc = document) {
  const root = doc.createElement('div');
  root.id = IDS.renderStage;
  root.className = OWN.cls;
  root.setAttribute('aria-hidden', 'true');
  root.style.cssText = `position:fixed;top:0;left:-100000px;width:${CONFIG.pdf.contentWidthPx}px;background:#fff;z-index:-1;pointer-events:none;`;

  const style = doc.createElement('style');
  style.textContent = CSS;
  root.appendChild(style);

  const elements = blocks.map((b) => {
    const holder = doc.createElement('div');
    holder.innerHTML = b.html;
    const el = holder.firstElementChild || holder;
    root.appendChild(el);
    return el;
  });
  return { root, elements };
}
