import { HOST_NAME, IDS } from '../../core/config.js';
import { bus } from '../../core/events.js';
import { Lang } from '../../i18n/index.js';
import { flashButton, iconButton } from '../../ui/flash.js';
import { icon } from '../../ui/icons.js';
import { copyText } from '../../util/clipboard.js';
import { registerBarWidget } from '../bar/registry.js';
import { isPdfRunning, runExport } from './controller.js';
import { extractConversation } from './extractor.js';
import { plainMessages } from './formats.js';
import { toggleDownloadMenu } from './menu.js';

registerBarWidget({
  id: 'copy-conversation',
  order: 50,
  build() {
    const btn = iconButton({ id: IDS.copyConversationBtn, iconName: 'copy', tip: Lang.t('toolbar.copy.title') });
    btn.addEventListener('click', async () => {
      let text = '';
      try {
        text = plainMessages(extractConversation())
          .filter((m) => m.content)
          .map((m) => `${m.role === 'user' ? 'You' : HOST_NAME}:\n${m.content}`)
          .join('\n\n');
      } catch {
        /* handled below */
      }
      if (!text) return flashButton(btn, false, Lang.t('download.noConversation'));
      const ok = await copyText(text);
      if (ok) bus.emit('activity', { kind: 'copy' });
      flashButton(btn, ok);
    });
    return btn;
  },
});

registerBarWidget({
  id: 'export',
  order: 60,
  build() {
    const btn = iconButton({ id: IDS.exportBtn, iconName: 'download', tip: Lang.t('toolbar.download.title') });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDownloadMenu(btn, async (format) => {
        if (format !== 'pdf') return void runExport(format);
        btn.setAttribute('aria-busy', 'true');
        btn.innerHTML = icon('spinner', 17);
        try {
          await runExport('pdf');
        } finally {
          btn.removeAttribute('aria-busy');
          btn.innerHTML = icon('download', 17);
        }
      });
    });
    return btn;
  },
  update(el) {
    // Reflect an in-flight export started from the per-reply button too.
    const busy = isPdfRunning();
    if (busy !== (el.getAttribute('aria-busy') === 'true')) el.setAttribute('aria-busy', String(busy));
  },
});
