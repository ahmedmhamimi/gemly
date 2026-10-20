/**
 * PDF generation: blocks -> measured -> rasterised in bounded chunks -> jsPDF.
 *
 * Why chunks: the previous design rasterised the whole chat into ONE canvas,
 * which silently fails (blank/empty PDF or out-of-memory) once the chat is
 * taller than the browser's canvas limit (~16k px) - i.e. only a few pages.
 * Here every raster pass is bounded (CONFIG.pdf.maxChunkCssPx /
 * maxCanvasHeightPx) and its canvas is released before the next, so memory
 * stays flat and chat length is unlimited.
 */
import { BRAND_NAME, CONFIG } from '../../../core/config.js';
import { createLogger } from '../../../core/log.js';
import { nextFrame } from '../../../util/dom.js';
import { buildBlocks } from './blocks.js';
import { groupIntoChunks, planPlacements } from './pagination.js';
import { buildStage, createSurface } from './stage.js';
import { ensurePdfLibs } from './vendor.js';

const log = createLogger('pdf');

export class PdfEngineError extends Error {}

function releaseCanvas(canvas) {
  canvas.width = canvas.height = 0; // frees the backing store immediately
}

/** Crop [topPx, topPx+heightPx) out of `src` into a JPEG data URL. */
function sliceToJpeg(src, topPx, heightPx, quality) {
  const slice = document.createElement('canvas');
  slice.width = src.width;
  slice.height = Math.max(1, heightPx);
  const ctx = slice.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, slice.width, slice.height);
  ctx.drawImage(src, 0, topPx, src.width, heightPx, 0, 0, src.width, heightPx);
  const data = slice.toDataURL('image/jpeg', quality);
  releaseCanvas(slice);
  return data;
}

/** Heights (css px) of every block, measured in one cheap layout pass. */
async function measure(blocks, surface) {
  const { root, elements } = buildStage(blocks, surface.doc);
  surface.mount.appendChild(root);
  try {
    await surface.doc.fonts?.ready;
    await nextFrame();
    const view = surface.doc.defaultView;
    return elements.map((el) => {
      const cs = view.getComputedStyle(el);
      return el.getBoundingClientRect().height + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
    });
  } finally {
    root.remove();
  }
}

/** Fewer pixels for very long chats: keeps time and memory bounded. */
function scaleFor(totalCssPx) {
  const pages = (totalCssPx * ((CONFIG.pdf.pageWidthPt - CONFIG.pdf.marginPt * 2) / CONFIG.pdf.contentWidthPx)) / CONFIG.pdf.pageHeightPt;
  if (pages <= 40) return CONFIG.pdf.renderScale;
  if (pages <= 100) return 1.6;
  return 1.25;
}

/**
 * @param {{ title: string, messages: any[] }} conversation
 * @param {string} filename stem, without extension
 * @param {{ onProgress?: (fraction: number) => void }} [opts]
 */
export async function exportPdf(conversation, filename, { onProgress } = {}) {
  if (!(await ensurePdfLibs())) throw new PdfEngineError('PDF engine could not be loaded');

  const blocks = buildBlocks(conversation);
  const surface = createSurface();
  try {
    await render(conversation, filename, blocks, surface, { onProgress });
  } finally {
    surface.dispose();
  }
}

async function render(conversation, filename, blocks, surface, { onProgress }) {
  const { pageWidthPt, pageHeightPt, marginPt, renderScale, jpegQuality, blockSpacingPt, maxChunkCssPx, maxCanvasHeightPx } = CONFIG.pdf;
  const contentWidthPt = pageWidthPt - marginPt * 2;
  const page = { marginPt, contentHeightPt: pageHeightPt - marginPt * 2, spacingPt: blockSpacingPt };
  const heights = await measure(blocks, surface);
  const baseScale = Math.min(renderScale, scaleFor(heights.reduce((a, b) => a + b, 0)));
  const chunks = groupIntoChunks(heights, maxChunkCssPx);
  log.debug(`pdf: ${blocks.length} blocks in ${chunks.length} chunk(s)`);

  const pdf = new window.jspdf.jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
  pdf.setProperties({ title: conversation.title, creator: BRAND_NAME });
  let cursorY = marginPt;
  let drewAnything = false;

  for (let c = 0; c < chunks.length; c++) {
    const indices = chunks[c];
    const t0 = performance.now();
    const { root, elements } = buildStage(indices.map((i) => blocks[i]), surface.doc);
    surface.mount.appendChild(root);
    let canvas = null;
    try {
      await nextFrame();
      const rootTop = root.getBoundingClientRect().top;
      const rects = elements.map((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top - rootTop, height: r.height };
      });
      const stageHeight = root.getBoundingClientRect().height;
      surface.resize(stageHeight);
      // Keep BOTH canvas dimensions inside browser limits.
      const scale = Math.max(0.5, Math.min(baseScale, maxCanvasHeightPx / Math.max(stageHeight, 1)));

      canvas = await window.html2canvas(root, { scale, backgroundColor: '#ffffff', logging: false, useCORS: false, windowHeight: Math.ceil(stageHeight) + 4 });
      if (!canvas.width || !canvas.height) throw new Error('PDF render produced an empty canvas');
      const ptPerCanvasPx = contentWidthPt / canvas.width;

      for (const rect of rects) {
        const topPx = Math.round(rect.top * scale);
        const heightPx = Math.min(Math.round(rect.height * scale), canvas.height - topPx);
        if (heightPx <= 0) continue;
        const plan = planPlacements(heightPx * ptPerCanvasPx, cursorY, page);
        for (const p of plan.placements) {
          if (p.addPage) pdf.addPage();
          const srcTop = topPx + Math.round(p.srcPt / ptPerCanvasPx);
          const srcH = Math.max(1, Math.min(Math.round(p.hPt / ptPerCanvasPx), canvas.height - srcTop));
          pdf.addImage(sliceToJpeg(canvas, srcTop, srcH, jpegQuality), 'JPEG', marginPt, p.y, contentWidthPt, p.hPt);
          drewAnything = true;
        }
        cursorY = plan.cursorY;
      }
    } finally {
      if (canvas) releaseCanvas(canvas);
      root.remove();
    }
    log.debug(`pdf: chunk ${c + 1}/${chunks.length} done in ${Math.round(performance.now() - t0)}ms`);
    onProgress?.((c + 1) / chunks.length);
    await nextFrame(); // let the page breathe between chunks
  }

  if (!drewAnything) throw new Error('PDF has no content');
  pdf.save(`${filename}.pdf`);
}
