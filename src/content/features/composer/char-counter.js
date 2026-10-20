import { CONFIG, IDS } from '../../core/config.js';
import { Lang } from '../../i18n/index.js';
import { escapeHtml } from '../../util/text.js';
import { registerBarWidget } from '../bar/registry.js';

registerBarWidget({
  id: 'char-counter',
  order: 30,
  build() {
    const el = document.createElement('div');
    el.id = IDS.counter;
    el.className = 'gl-ui gl-stat';
    el.dataset.glTip = Lang.t('toolbar.charCounter.title');
    el.innerHTML = `<b id="${IDS.countSpan}">0</b><span class="gl-stat__unit">${escapeHtml(Lang.t('toolbar.charCounter.unit'))}</span>`;
    return el;
  },
  update(el, scan, ctx) {
    // Typing mutates the composer; skip if nothing there changed.
    if (!scan.all && !scan.zones.has('composer') && !scan.zones.has('global') && el.dataset.ready) return;
    el.dataset.ready = '1';
    const count = Array.from(ctx.host.editorText()).length; // code points: emoji count as one
    const span = el.querySelector(`#${IDS.countSpan}`);
    const text = count.toLocaleString();
    if (span.textContent !== text) span.textContent = text;
    const { warnAt, dangerAt } = CONFIG.charCounter;
    const level = count > dangerAt ? 'danger' : count > warnAt ? 'warn' : 'ok';
    if (el.dataset.level !== level) el.dataset.level = level;
  },
});
