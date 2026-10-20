/** The built-in per-reply controls: token badge, copy as plain text, download. */
import { bus } from '../../core/events.js';
import { createLogger } from '../../core/log.js';
import { GeminiHost as host } from '../../host/gemini.js';
import { Lang } from '../../i18n/index.js';
import { flashButton, iconButton } from '../../ui/flash.js';
import { icon } from '../../ui/icons.js';
import { copyText } from '../../util/clipboard.js';
import { htmlNodeToPlainText } from '../../util/plaintext.js';
import { sanitizeFilename } from '../../util/text.js';
import { runExport } from '../export/controller.js';
import { renderBlocks } from '../export/extractor.js';
import { toggleDownloadMenu } from '../export/menu.js';
import { registerMessageAction } from './registry.js';
import { GenerationTimer } from './timer.js';

const log = createLogger('message-actions');

// ---- token + time badge ------------------------------------------------------------

registerMessageAction({
  id: 'token-badge',
  order: 0,
  build() {
    const badge = document.createElement('span');
    badge.className = 'gl-ui gl-token';
    badge.hidden = true;
    return badge;
  },
  update(badge, turn, { isLast, generating }, ctx) {
    if (isLast && generating) return; // never badge a reply still streaming
    const entry = ctx.index.entry(turn);
    if (badge.dataset.len === String(entry.length) && !badge.hidden) return;

    // The measured time belongs to the newest reply only, and only once.
    const elapsed = isLast && badge.hidden ? GenerationTimer.consume() : null;
    const time = GenerationTimer.format(elapsed) || badge.dataset.time || null;
    badge.dataset.len = String(entry.length);
    if (time) badge.dataset.time = time;
    badge.dataset.glTip = time
      ? Lang.t('tokenCounter.title.withTime', { tokens: entry.tokens, time })
      : Lang.t('tokenCounter.title', { tokens: entry.tokens });
    badge.innerHTML =
      `<span class="gl-token__dot"></span><span>${entry.tokens.toLocaleString()}</span>` +
      `<span style="opacity:.75">${Lang.t('tokenCounter.unit')}</span>` +
      (time ? `<i>&middot;</i><span>${time}</span>` : '');
    badge.hidden = false;
  },
});

// ---- copy as plain text ------------------------------------------------------------

registerMessageAction({
  id: 'copy-plain',
  order: 10,
  build(turn) {
    const btn = iconButton({ iconName: 'copyPlain', tip: Lang.t('copyPlain.title'), size: 16, cls: 'gl-msg-btn' });
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const root = host.assistantRoot(turn);
      if (!root) return flashButton(btn, false);
      const ok = await copyText(htmlNodeToPlainText(root));
      if (ok) bus.emit('activity', { kind: 'copy' });
      flashButton(btn, ok);
    });
    return btn;
  },
});

// ---- per-reply download -------------------------------------------------------------

/** The prompt that produced this reply = nearest user turn above it. */
function buildExchange(modelTurn) {
  const root = host.assistantRoot(modelTurn);
  if (!root) return null;
  const turns = host.turns();
  const index = turns.indexOf(modelTurn);
  let userTurn = null;
  for (let i = (index === -1 ? turns.length : index) - 1; i >= 0; i--) {
    if (host.isUserTurn(turns[i])) {
      userTurn = turns[i];
      break;
    }
  }
  const messages = [];
  let prompt = '';
  if (userTurn) {
    prompt = host.userText(userTurn);
    if (prompt) messages.push({ role: 'user', content: prompt, isHTML: false });
  }
  messages.push({ role: 'assistant', content: renderBlocks(root), isHTML: true });
  const title = host.title();
  return { conversation: { title, messages }, baseName: `${sanitizeFilename((prompt || title).slice(0, 60))}-response` };
}

registerMessageAction({
  id: 'download',
  order: 20,
  build(turn) {
    const btn = iconButton({ iconName: 'download', tip: Lang.t('msgExport.title'), size: 16, cls: 'gl-msg-btn' });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      toggleDownloadMenu(btn, async (format) => {
        btn.disabled = true;
        btn.innerHTML = icon('spinner', 16);
        let ok = false;
        try {
          const exchange = buildExchange(turn);
          ok = exchange ? await runExport(format, { ...exchange, scope: 'reply' }) : false;
        } catch (err) {
          log.error('reply export failed', err);
        } finally {
          btn.disabled = false;
          btn.innerHTML = icon(ok ? 'check' : 'download', 16);
          btn.dataset.state = ok ? 'ok' : '';
          setTimeout(() => {
            if (btn.isConnected) {
              btn.innerHTML = icon('download', 16);
              delete btn.dataset.state;
            }
          }, 1300);
        }
      });
    });
    return btn;
  },
});
