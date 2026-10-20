/**
 * Two shortcuts that drive Gemini's own UI (so Gemini does the real work):
 *   - double-click a chat title in the sidebar -> rename it
 *   - double-click one of your prompts          -> edit it
 * One delegated listener, attached once.
 */
import { GeminiHost as host } from '../../host/gemini.js';
import { Lang } from '../../i18n/index.js';
import { Toast } from '../../ui/toast.js';
import { isOwn } from '../../util/dom.js';

const MOUSE = { bubbles: true, cancelable: true, view: window };

function hover(el) {
  ['mouseover', 'mouseenter', 'mousemove'].forEach((t) => el.dispatchEvent(new MouseEvent(t, MOUSE)));
}
function click(el) {
  ['mousedown', 'mouseup', 'click'].forEach((t) => el.dispatchEvent(new MouseEvent(t, MOUSE)));
}

/** Retry `fn` until it returns truthy (Angular menus appear a frame or two later). */
function retry(fn, tries, delay, onFail) {
  const attempt = (left) => {
    if (fn()) return;
    if (left > 0) setTimeout(() => attempt(left - 1), delay);
    else onFail?.();
  };
  attempt(tries);
}

function renameChat(link) {
  const row = host.rowFor(link);
  const menuBtn = host.rowMenuButton(row, link);
  if (!menuBtn) return Toast.show(Lang.t('qa.menuNotFound'));
  hover(row);
  hover(menuBtn);
  requestAnimationFrame(() => {
    click(menuBtn);
    retry(
      () => {
        const item = host.findRenameItem();
        if (!item) return false;
        click(item);
        retry(() => {
          const input = host.dialogInput();
          if (!input) return false;
          input.focus();
          input.select?.();
          return true;
        }, 10, 80);
        return true;
      },
      10,
      70,
      () => Toast.show(Lang.t('qa.renameNotFound')),
    );
  });
}

function editMessage(userTurn, event) {
  window.getSelection()?.removeAllRanges();
  hover(userTurn);
  retry(
    () => {
      const btn = host.userEditButton(userTurn);
      if (!btn) return false;
      event.preventDefault();
      click(btn);
      return true;
    },
    4,
    60,
    () => Toast.show(Lang.t('qa.editNotFound')),
  );
}

/** @type {import('../../core/app.js').Feature} */
export const quickActionsFeature = {
  id: 'quick-actions',
  zones: [],
  init(ctx) {
    ctx.listen(document, 'dblclick', (e) => {
      const t = e.target;
      if (!t?.closest || isOwn(t)) return;
      const link = t.closest(host.selectors.conversationLink);
      if (link && host.sidebarLinks().includes(link)) {
        if (t.closest('button')) return;
        e.preventDefault();
        e.stopPropagation();
        renameChat(link);
        return;
      }
      const user = t.closest(host.selectors.userTurn);
      if (user && !t.closest('button, a, textarea, input, [contenteditable="true"]')) editMessage(user, e);
    }, true);
  },
};
