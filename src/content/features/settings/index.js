/**
 * Settings: a gear button in the bar that opens a dialog hosting the registered
 * settings sections (features/settings/registry.js).
 */
import { IDS } from '../../core/config.js';
import { Lang } from '../../i18n/index.js';
import { iconButton } from '../../ui/flash.js';
import { Modal } from '../../ui/modal.js';
import { escapeHtml } from '../../util/text.js';
import { registerBarWidget } from '../bar/registry.js';
import './features-section.js';
import { settingsSections } from './registry.js';

export function openSettings() {
  const content = document.createElement('div');
  const modal = Modal.open({ title: Lang.t('settings.title'), content, width: 520, id: IDS.settingsDialog });
  for (const s of settingsSections()) {
    const head = document.createElement('div');
    head.className = 'gl-modal__section';
    head.innerHTML = escapeHtml(s.title());
    content.append(head, s.build({ close: modal.close }));
  }
}

registerBarWidget({
  id: 'settings',
  order: 70,
  build() {
    const btn = iconButton({ id: IDS.settingsBtn, iconName: 'settings', tip: Lang.t('settings.button.title') });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSettings();
    });
    return btn;
  },
});

/** @type {import('../../core/app.js').Feature} */
export const settingsFeature = {
  id: 'settings',
  zones: [],
  teardown() {
    Modal.closeAll();
  },
};
