/**
 * Settings > Features: one switch per feature, driven by the central registry
 * (core/feature-registry.js). A switch stores the person's override in the
 * Store; it applies on the next page load (hot-swapping init() listeners is not
 * attempted), which the dialog says plainly and offers a Reload button for.
 */
import { Features } from '../../core/feature-registry.js';
import { Store } from '../../core/store.js';
import { Lang } from '../../i18n/index.js';
import { infoIcon } from '../../ui/info.js';
import { escapeHtml } from '../../util/text.js';
import { registerSettingsSection } from './registry.js';

const titleOf = (id) => {
  const key = `feature.${id}.title`;
  const t = Lang.t(key);
  return t === key ? id : t;
};

/** Pure: how a row should look. @returns {{ checked: boolean, disabled: boolean, note: string|null }} */
export function rowState(def, flag, overrides, names = titleOf) {
  if (flag.source === 'config') return { checked: false, disabled: true, note: 'unavailable' };
  if (def.locked) return { checked: true, disabled: true, note: 'locked' };
  const intent = overrides[def.id] !== false;
  if (intent && !flag.enabled) {
    const need = (def.requires || []).find((r) => !Features.isEnabled(r));
    return { checked: true, disabled: false, note: need ? `needs:${names(need)}` : null };
  }
  return { checked: intent, disabled: false, note: null };
}

function build() {
  const root = document.createElement('div');
  const hint = document.createElement('p');
  hint.className = 'gl-modal__hint';
  hint.textContent = Lang.t('settings.features.hint');
  const notice = document.createElement('div');
  notice.className = 'gl-notice';
  notice.hidden = true;
  notice.innerHTML = `<span>${escapeHtml(Lang.t('settings.features.pending'))}</span>`;
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'gl-btn gl-btn--primary';
  reload.textContent = Lang.t('settings.features.reload');
  reload.addEventListener('click', () => location.reload());
  notice.appendChild(reload);

  const list = document.createElement('div');
  const overrides = () => Store.get('features');
  const sig = () => Object.keys(overrides()).sort().join(','); // overrides only ever hold `false`
  const startSig = sig(); // what this page load is running with

  const draw = () => {
    const flags = new Map(Features.report().map((f) => [f.id, f]));
    list.replaceChildren(
      ...Features.defs().map((def) => {
        const st = rowState(def, flags.get(def.id), overrides());
        const row = document.createElement('label');
        row.className = 'gl-row';
        const sw = `<span class="gl-switch"><input type="checkbox"${st.checked ? ' checked' : ''}${st.disabled ? ' disabled' : ''}><span class="gl-switch__track"></span></span>`;
        let sub = '';
        if (st.note === 'locked') sub = Lang.t('settings.features.locked');
        else if (st.note === 'unavailable') sub = Lang.t('settings.features.unavailable');
        else if (st.note?.startsWith('needs:')) sub = Lang.t('settings.features.needs', { name: st.note.slice(6) });
        row.innerHTML = `<span class="gl-row__main"><span class="gl-row__title" dir="auto">${escapeHtml(titleOf(def.id))}</span>${sub ? `<span class="gl-row__sub" style="display:block">${escapeHtml(sub)}</span>` : ''}</span>${sw}`;
        const infoKey = `feature.${def.id}.info`;
        const infoText = Lang.t(infoKey);
        if (infoText !== infoKey) row.querySelector('.gl-row__title').append(infoIcon(infoText));
        const input = row.querySelector('input');
        input.addEventListener('change', () => {
          Store.update('features', (f) => {
            if (input.checked) delete f[def.id];
            else f[def.id] = false;
          });
          notice.hidden = sig() === startSig;
          draw();
        });
        return row;
      }),
    );
  };
  draw();
  root.append(hint, notice, list);
  return root;
}

registerSettingsSection({ id: 'features', order: 10, title: () => Lang.t('settings.features.title'), build });
