/**
 * Saved: text highlights with notes (painted without touching Gemini's DOM), notes on
 * starred messages, and a Saved panel for this chat or all chats. Included in exports.
 */
import { IDS } from '../../core/config.js';
import { bus } from '../../core/events.js';
import { GeminiHost as host } from '../../host/gemini.js';
import { Lang } from '../../i18n/index.js';
import { iconButton } from '../../ui/flash.js';
import { Modal } from '../../ui/modal.js';
import { registerBarWidget } from '../bar/registry.js';
import { clearPaint, invalidate, paint } from './painter.js';
import { openSavedPanel } from './panel.js';
import { hideBar, initSelectionBar } from './selection-bar.js';
import { state } from './state.js';

registerBarWidget({
  id: 'saved',
  order: 63,
  build() {
    const btn = iconButton({ id: IDS.savedBtn, iconName: 'star', tip: Lang.t('saved.button.title') });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSavedPanel();
    });
    return btn;
  },
});

/** @type {import('../../core/app.js').Feature} */
export const savedFeature = {
  id: 'saved',
  zones: ['chat'],
  init(ctx) {
    initSelectionBar(ctx, () => ({ scan: state.scan, convId: host.currentConversationId() }));
    ctx.onDispose(bus.on('store', ({ names }) => {
      if (!names.includes('highlights')) return;
      invalidate();
      if (state.scan) paint(state.scan, host.currentConversationId());
    }));
    ctx.onDispose(bus.on('navigate', () => {
      hideBar();
      invalidate();
    }));
  },
  scan(scan, ctx) {
    state.scan = { turns: scan.turns, index: ctx.index, generating: scan.generating };
    paint(state.scan, host.currentConversationId());
  },
  teardown() {
    clearPaint();
    hideBar();
    state.scan = null;
    Modal.closeAll();
  },
};
