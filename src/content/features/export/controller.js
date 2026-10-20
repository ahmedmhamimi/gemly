/**
 * Export orchestration shared by the whole-chat button and the per-reply
 * button: format dispatch, the single-PDF-at-a-time lock, progress pill,
 * and user-facing errors. UI widgets only call `runExport`.
 */
import { bus } from '../../core/events.js';
import { createLogger } from '../../core/log.js';
import { Lang } from '../../i18n/index.js';
import { LoadingPill, Toast } from '../../ui/toast.js';
import { sanitizeFilename } from '../../util/text.js';
import { extractConversation } from './extractor.js';
import { downloadAs } from './formats.js';
import { exportPdf, PdfEngineError } from './pdf/export.js';

const log = createLogger('export');
let pdfRunning = false;

/**
 * @param {'pdf'|'json'|'txt'|'md'|'obsidian'} format
 * @param {{ conversation?: object, baseName?: string, scope?: 'chat'|'reply' }} [opts]
 *        omit `conversation` to export the whole open chat
 * @returns {Promise<boolean>} true on success
 */
export async function runExport(format, { conversation, baseName, scope = 'chat' } = {}) {
  let conv = conversation;
  try {
    conv ??= extractConversation();
  } catch (err) {
    log.error('could not read conversation', err);
    Toast.show(Lang.t(scope === 'chat' ? 'download.failed' : 'export.readFailed'));
    return false;
  }
  if (!conv?.messages?.length) {
    Toast.show(Lang.t(scope === 'chat' ? 'download.noConversation' : 'export.nothing'));
    return false;
  }
  const name = baseName || sanitizeFilename(conv.title);

  if (format !== 'pdf') {
    try {
      return downloadAs(conv, name, format);
    } catch (err) {
      log.error('export failed', err);
      Toast.show(Lang.t(scope === 'chat' ? 'download.failed' : 'export.msgFailed'));
      return false;
    }
  }

  if (pdfRunning) {
    Toast.show(Lang.t('pdf.inProgress'));
    return false;
  }
  pdfRunning = true;
  const label = Lang.t(scope === 'chat' ? 'loading.pdf.whole' : 'loading.pdf.message');
  LoadingPill.show(label);
  try {
    await exportPdf(conv, name, {
      onProgress: (f) => LoadingPill.update(`${label} ${Math.round(f * 100)}%`),
    });
    LoadingPill.finish(true, Lang.t('loading.pdf.downloaded'));
    bus.emit('activity', { kind: 'export' });
    return true;
  } catch (err) {
    log.error('pdf export failed', err);
    if (err instanceof PdfEngineError) {
      LoadingPill.finish(false, Lang.t('loading.pdf.engineFail'));
      Toast.show(Lang.t('pdf.engineLoadFailed'));
    } else {
      LoadingPill.finish(false, Lang.t('loading.pdf.failed'));
      Toast.show(Lang.t(scope === 'chat' ? 'download.failed' : 'export.msgFailed'));
    }
    return false;
  } finally {
    pdfRunning = false;
  }
}

export const isPdfRunning = () => pdfRunning;
