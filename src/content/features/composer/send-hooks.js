/**
 * Send interception, done ONCE for the whole extension.
 *
 * Features that need to act on a prompt as it is sent (tone tag, timers, …)
 * register a hook instead of each adding their own Enter/click listeners.
 *
 *   registerSendHook({ id, prepare?(editor): boolean })
 *     `prepare` may modify the prompt (return true if it did). If any hook
 *     modified it, the send is held for a beat - so Gemini's editor state
 *     includes the change - and then re-fired.
 *
 * Guards (each one is a real corner case):
 *   - nothing happens while Gemini is generating (Enter there is ignored by
 *     Gemini, and the send button is the STOP button - re-clicking it would
 *     abort the reply),
 *   - nothing happens for an empty prompt, key-repeat, IME composition,
 *     Shift+Enter (newline), or when the send button is disabled,
 *   - events we generate ourselves are not re-intercepted.
 */
import { bus } from '../../core/events.js';
import { Features } from '../../core/feature-registry.js';
import { GeminiHost as host } from '../../host/gemini.js';

/** @type {{ id: string, prepare?: (editor: HTMLElement) => boolean }[]} */
const hooks = [];
let bypass = false;

export function registerSendHook(hook) {
  if (hooks.some((h) => h.id === hook.id)) throw new Error(`Duplicate send hook "${hook.id}"`);
  hooks.push(hook);
}

/** Every registered id, on or off (manifest test). */
export const registeredSendHookIds = () => hooks.map((h) => h.id);

function resend(editor) {
  if (host.isGenerating()) return; // a reply started meanwhile: don't hit "stop"
  const btn = host.sendButton();
  bypass = true;
  try {
    if (btn && host.canSend(btn)) {
      btn.click();
    } else if (editor?.isConnected) {
      editor.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }),
      );
    }
  } finally {
    setTimeout(() => {
      bypass = false;
    }, 80);
  }
}

function handleSend(editor, event) {
  if (bypass || !editor || host.isGenerating()) return;
  const btn = host.sendButton();
  if (btn && !host.canSend(btn)) return; // Gemini would refuse (uploading, empty…)
  if (!host.editorText(editor).trim()) return;

  bus.emit('user-sent', {});
  let modified = false;
  for (const hook of hooks) {
    if (!Features.isFacetEnabled('hook', hook.id)) continue;
    try {
      if (hook.prepare?.(editor)) modified = true;
    } catch (err) {
      console.warn(`[Gemly] send hook "${hook.id}" failed`, err);
    }
  }
  if (!modified) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  setTimeout(() => resend(editor), 90);
}

/** @type {import('../../core/app.js').Feature} */
export const sendHooksFeature = {
  id: 'send-hooks',
  zones: [],
  init(ctx) {
    ctx.listen(
      document,
      'keydown',
      (e) => {
        if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.repeat || e.isComposing || e.keyCode === 229 || e.defaultPrevented) return;
        const editor = host.editor();
        if (editor && editor.contains(e.target)) handleSend(editor, e);
      },
      true,
    );
    ctx.listen(
      document,
      'click',
      (e) => {
        const btn = e.target.closest?.('button');
        if (host.isSendButton(btn)) handleSend(host.editor(), e);
      },
      true,
    );
  },
};
