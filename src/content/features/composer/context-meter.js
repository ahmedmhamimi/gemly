import { CONFIG, IDS } from '../../core/config.js';
import { Lang } from '../../i18n/index.js';
import { registerBarWidget } from '../bar/registry.js';

registerBarWidget({
  id: 'context-meter',
  order: 40,
  build() {
    const el = document.createElement('div');
    el.id = IDS.contextMeter;
    el.className = 'gl-ui gl-stat';
    el.innerHTML = '<span class="gl-meter__track"><span class="gl-meter__fill"></span></span><b class="gl-meter__label">0%</b>';
    return el;
  },
  update(el, scan, ctx) {
    if (!scan.all && !scan.zones.has('chat') && !scan.zones.has('global') && el.dataset.ready) return;
    el.dataset.ready = '1';
    const tokens = ctx.index.totalTokens(scan.turns);
    const limit = CONFIG.contextWindow.limit;
    const pct = Math.min(100, (tokens / limit) * 100);
    el.querySelector('.gl-meter__fill').style.width = `${tokens > 0 ? Math.max(pct, 3).toFixed(1) : 0}%`;
    el.querySelector('.gl-meter__label').textContent = pct > 0 && pct < 1 ? '<1%' : `${Math.round(pct)}%`;
    el.dataset.level = pct > 90 ? 'danger' : pct > 70 ? 'warn' : 'ok';
    el.dataset.glTip = Lang.t('contextMeter.title.estimate', { tokens: tokens.toLocaleString(), limit: limit.toLocaleString() });
  },
});
