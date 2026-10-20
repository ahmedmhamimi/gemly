/**
 * "Code & tables" button on replies that contain code blocks or tables:
 * copy all code, download the code blocks as files (extensions guessed from the
 * language; several files arrive as one ZIP), tables as CSV or Excel.
 * Everything is derived from the same sanitized HTML the exporters use.
 */
import { createLogger } from '../../core/log.js';
import { GeminiHost as host } from '../../host/gemini.js';
import { Lang } from '../../i18n/index.js';
import { flashButton, iconButton } from '../../ui/flash.js';
import { Popover } from '../../ui/popover.js';
import { Toast } from '../../ui/toast.js';
import { copyText } from '../../util/clipboard.js';
import { escapeHtml, sanitizeFilename } from '../../util/text.js';
import { ZipWriter } from '../../util/zip.js';
import { renderBlocks } from '../export/extractor.js';
import { downloadBlob } from '../export/formats.js';
import { codeBlocks, tables } from '../export/serialize/markup.js';
import { registerMessageAction } from '../message-actions/registry.js';
import { tableToCsv } from './csv.js';
import { codeFileNames } from './filetypes.js';
import { buildXlsx } from './xlsx.js';

const log = createLogger('extract');
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** @returns {{ code: {lang: string, code: string}[], tables: string[][][] }} */
function read(turn) {
  const root = host.assistantRoot(turn);
  const html = root ? renderBlocks(root) : '';
  return { code: codeBlocks(html), tables: tables(html).filter((t) => t.length) };
}

const baseName = () => sanitizeFilename(host.title(), 'chat');

/** One file -> saved as is; several -> one ZIP (so the browser does not ask to allow many downloads). */
function saveFiles(files, zipName) {
  if (files.length === 1) {
    downloadBlob(new Blob([files[0].data], { type: files[0].mime }), files[0].name);
    return;
  }
  const zip = new ZipWriter();
  files.forEach((f) => zip.add(f.name, f.data));
  downloadBlob(new Blob(zip.finish(), { type: 'application/zip' }), zipName);
}

const actions = {
  async copyCode({ code }) {
    return copyText(code.map((b) => b.code).join('\n\n'));
  },
  downloadCode({ code }) {
    const base = baseName();
    const names = codeFileNames(code, base);
    saveFiles(code.map((b, i) => ({ name: names[i], data: `${b.code}\n`, mime: 'text/plain;charset=utf-8' })), `${base}-code.zip`);
    return true;
  },
  downloadCsv({ tables: t }) {
    const base = baseName();
    saveFiles(t.map((rows, i) => ({ name: `${base}-table-${i + 1}.csv`, data: tableToCsv(rows), mime: 'text/csv;charset=utf-8' })), `${base}-tables.zip`);
    return true;
  },
  downloadXlsx({ tables: t }) {
    downloadBlob(new Blob(buildXlsx(t), { type: XLSX_MIME }), `${baseName()}-tables.xlsx`);
    return true;
  },
};

function openMenu(btn, turn) {
  const data = read(turn);
  if (!data.code.length && !data.tables.length) return flashButton(btn, false);
  const items = [];
  if (data.code.length) {
    items.push(['copyCode', Lang.t('extract.copyCode', { n: data.code.length })], ['downloadCode', Lang.t('extract.downloadCode', { n: data.code.length })]);
  }
  if (data.tables.length) {
    items.push(['downloadCsv', Lang.t('extract.csv', { n: data.tables.length })], ['downloadXlsx', Lang.t('extract.xlsx', { n: data.tables.length })]);
  }
  const panel = document.createElement('div');
  panel.className = 'gl-ui gl-pop gl-pop--glass gl-dlmenu';
  panel.setAttribute('role', 'menu');
  for (const [key, label] of items) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'gl-dlmenu__item';
    row.setAttribute('role', 'menuitem');
    row.innerHTML = `<span class="gl-dlmenu__label">${escapeHtml(label)}</span>`;
    row.addEventListener('click', async () => {
      Popover.closeAll();
      try {
        const ok = await actions[key](read(turn)); // re-read: the reply may have changed since the menu opened
        if (key === 'copyCode') flashButton(btn, ok);
        else if (ok) Toast.show(Lang.t('extract.saved'));
      } catch (err) {
        log.error(`${key} failed`, err);
        Toast.show(Lang.t('extract.error'));
      }
    });
    panel.appendChild(row);
  }
  Popover.open({ anchor: btn, content: panel });
}

registerMessageAction({
  id: 'extract',
  order: 25, // after the per-reply download (20): an explicit order, not import order
  build(turn) {
    const btn = iconButton({ iconName: 'code', tip: Lang.t('extract.button.title'), size: 16, cls: 'gl-msg-btn' });
    btn.hidden = true; // shown once the reply is known to contain code or a table
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const cur = Popover.current();
      if (cur?.anchor === btn) cur.close();
      else openMenu(btn, turn);
    });
    return btn;
  },
  update(btn, turn, { isLast, generating }, ctx) {
    if (isLast && generating) return; // still streaming
    const entry = ctx.index.entry(turn);
    if (btn.dataset.len === String(entry.length)) return; // unchanged since last look: no re-parsing
    btn.dataset.len = String(entry.length);
    const d = read(turn);
    btn.hidden = !d.code.length && !d.tables.length;
  },
});
