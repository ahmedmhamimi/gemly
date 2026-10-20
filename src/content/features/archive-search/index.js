/**
 * Search across all saved chats: a bar button and the Alt+Shift+F shortcut open
 * the dialog (dialog.js). Indexing and queries run in the service worker.
 */
import { IDS } from '../../core/config.js';
import { Lang } from '../../i18n/index.js';
import { iconButton } from '../../ui/flash.js';
import { Modal } from '../../ui/modal.js';
import { registerBarWidget } from '../bar/registry.js';
import { openSearchDialog } from './dialog.js';
import './settings-section.js';

registerBarWidget({
  id: 'global-search',
  order: 64,
  build() {
    const btn = iconButton({ id: IDS.searchBtn, iconName: 'search', tip: `${Lang.t('gsearch.button.title')} (Alt+Shift+F)` });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSearchDialog();
    });
    return btn;
  },
});

/** @type {import('../../core/app.js').Feature} */
export const globalSearchFeature = {
  id: 'global-search',
  zones: [],
  init(ctx) {
    // Alt+Shift+F: no Ctrl/Meta, so it never collides with the browser's or Gemini's own Ctrl/Cmd shortcuts.
    ctx.listen(document, 'keydown', (e) => {
      if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyF') {
        e.preventDefault();
        openSearchDialog();
      }
    });
  },
  teardown() {
    Modal.closeAll();
  },
};
