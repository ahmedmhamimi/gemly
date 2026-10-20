/**
 * Summarize and continue: when a chat gets long (or on demand), ask Gemini's own
 * composer for a summary, wait for the answer, open a new chat and PRE-FILL the
 * summary as its starting context. No external API: it is the same chat box a person
 * would type in. The request text is editable (in the confirmation dialog).
 */
import { CONFIG, IDS } from '../../core/config.js';
import { JobCancelled, waitUntil } from '../../core/jobs.js';
import { createLogger } from '../../core/log.js';
import { Store } from '../../core/store.js';
import { GeminiHost as host } from '../../host/gemini.js';
import { Lang } from '../../i18n/index.js';
import { iconButton } from '../../ui/flash.js';
import { Modal } from '../../ui/modal.js';
import { Toast } from '../../ui/toast.js';
import { copyText } from '../../util/clipboard.js';
import { h } from '../../util/dom.js';
import { insertText } from '../../util/editor.js';
import { openFreshChat, isFreshChat } from '../../util/new-chat.js';
import { registerBarWidget } from '../bar/registry.js';
import { renderBlocks } from '../export/extractor.js';
import { toMarkdown } from '../export/serialize/markup.js';
import { sendAndWait } from '../prompts/chain.js';
import { closeChainBar, showStatusBar } from '../prompts/chain-bar.js';
import { infoIcon } from '../../ui/info.js';
import { registerSettingsSection } from '../settings/registry.js';
import { buildHandoff, contextPercent, continueInNewChat, freshHandoff, resolveText, shouldSuggest, summarizeChat } from './logic.js';

const log = createLogger('summarize');
let running = null;
const suggested = new Set(); // chat ids we already nudged about, this page session

const settings = () => Store.get('summary');
const defaultPrompt = () => Lang.t('summary.prompt.default');
const defaultIntro = () => Lang.t('summary.intro.default');

/** The newest answer as Markdown (what Gemini just wrote in reply to the summary request). */
function readLastAnswer() {
  const turns = host.turns();
  const last = turns[turns.length - 1];
  if (!last || host.isUserTurn(last)) return '';
  const root = host.assistantRoot(last);
  return root ? toMarkdown(renderBlocks(root)) : '';
}

async function runFlow(prompt, intro) {
  if (running) return void Toast.show(Lang.t('chain.busy'));
  const ac = new AbortController();
  running = ac;
  const bar = showStatusBar({ text: Lang.t('summary.status.summarizing'), onStop: () => ac.abort() });
  try {
    const summary = await summarizeChat({
      prompt,
      send: (text) => sendAndWait(text, { signal: ac.signal, host, insert: insertText }),
      getChatId: () => host.currentConversationId(),
      readSummary: readLastAnswer,
    });
    bar.setText(Lang.t('summary.status.opening'));
    const text = buildHandoff(intro, summary);
    const mode = await continueInNewChat({
      text,
      openFresh: () => openFreshChat(host, { signal: ac.signal }),
      insert: (t) => {
        const ed = host.editor();
        if (!ed || !insertText(ed, t, { atEnd: true })) return false;
        ed.focus?.();
        return true;
      },
      persistHandoff: (t) => Store.set('handoff', { text: t, at: Date.now() }),
      reload: () => location.assign('/app'), // last resort when SPA navigation is not possible
    });
    if (mode === 'inserted') Toast.show(Lang.t('summary.done.inserted'), { ms: 7000 });
    else if (mode === 'failed') {
      const ok = await copyText(text);
      Toast.show(Lang.t(ok ? 'summary.done.copied' : 'summary.done.failed'), { ms: 7000 });
    }
  } catch (err) {
    if (err instanceof JobCancelled || ac.signal.aborted) Toast.show(Lang.t('summary.cancelled'));
    else {
      log.warn('summarize failed', err);
      const key = `summary.error.${err?.code}`;
      Toast.show(Lang.t(Lang.t(key) === key ? 'summary.error.generic' : key), { ms: 6000 });
    }
  } finally {
    bar.close();
    running = null;
  }
}

export function openSummarizeDialog() {
  if (!host.currentConversationId() || !host.turns().length) return void Toast.show(Lang.t('summary.error.no-chat'));
  const content = h('div');
  const modal = Modal.open({ title: Lang.t('summary.dialog.title'), content, width: 520, id: IDS.summarizeDialog });
  const s = settings();
  const prompt = h('textarea', { cls: 'gl-input', attrs: { rows: '6', maxlength: '4000', 'aria-label': Lang.t('summary.dialog.prompt') } });
  const intro = h('textarea', { cls: 'gl-input', attrs: { rows: '2', maxlength: '1000', 'aria-label': Lang.t('summary.dialog.intro') } });
  prompt.value = resolveText(s.prompt, defaultPrompt());
  intro.value = resolveText(s.intro, defaultIntro());
  for (const el of [prompt, intro]) el.addEventListener('keydown', (e) => e.stopPropagation());
  const reset = h('button', { cls: 'gl-btn gl-btn--small', attrs: { type: 'button' }, text: Lang.t('summary.dialog.reset') });
  reset.addEventListener('click', () => {
    prompt.value = defaultPrompt();
    intro.value = defaultIntro();
  });
  const go = h('button', { cls: 'gl-btn gl-btn--primary', attrs: { type: 'button' }, text: Lang.t('summary.dialog.start') });
  const cancel = h('button', { cls: 'gl-btn', attrs: { type: 'button' }, text: Lang.t('prompts.form.cancel') });
  cancel.addEventListener('click', () => modal.close());
  go.addEventListener('click', () => {
    const p = prompt.value.trim() || defaultPrompt();
    const i = intro.value.trim();
    // Keep customisations; an unchanged default is stored as empty so it keeps following the UI language.
    Store.update('summary', (v) => {
      v.prompt = p === defaultPrompt() ? '' : p;
      v.intro = i === defaultIntro() ? '' : i;
    });
    modal.close();
    void runFlow(p, i);
  });
  content.append(
    h('p', { cls: 'gl-modal__hint', text: Lang.t('summary.dialog.what') }),
    h('div', { cls: 'gl-field', children: [h('label', { text: Lang.t('summary.dialog.prompt') }), prompt] }),
    h('div', { cls: 'gl-field', children: [h('label', { text: Lang.t('summary.dialog.intro') }), intro] }),
    h('div', { cls: 'gl-modal__foot', attrs: { style: 'padding:10px 0 0;border:0' }, children: [reset, cancel, go] }),
  );
}

registerBarWidget({
  id: 'summarize',
  order: 66,
  build() {
    const btn = iconButton({ id: IDS.summarizeBtn, iconName: 'compress', tip: Lang.t('summary.button.title') });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSummarizeDialog();
    });
    return btn;
  },
  update(el, scan, ctx) {
    if (!scan.all && !scan.zones.has('chat') && !scan.zones.has('global') && el.dataset.ready) return;
    el.dataset.ready = '1';
    const id = host.currentConversationId();
    const pct = contextPercent(ctx.index.totalTokens(scan.turns), CONFIG.contextWindow.limit);
    const hint = !!id && shouldSuggest(pct, settings().hintAt);
    if (el.dataset.hint !== String(hint)) {
      el.dataset.hint = String(hint);
      el.dataset.glTip = hint ? Lang.t('summary.button.title.hint', { pct: Math.round(pct) }) : Lang.t('summary.button.title');
    }
    // One gentle nudge per chat per page session, never while a reply is streaming.
    if (hint && !scan.generating && !suggested.has(id)) {
      suggested.add(id);
      Toast.show(Lang.t('summary.suggest', { pct: Math.round(pct) }), { ms: 9000, action: { label: Lang.t('summary.suggest.action'), onClick: openSummarizeDialog } });
    }
  },
});

/** If the page had to reload to reach a new chat, put the stored summary into its prompt box. */
async function consumeHandoff() {
  const stored = Store.get('handoff');
  if (!stored) return;
  Store.set('handoff', null); // one shot, whatever happens next
  const fresh = freshHandoff(stored);
  if (!fresh) return;
  const ok = await waitUntil(() => isFreshChat(host) && host.editor() && !host.editorText(host.editor()).trim(), { timeoutMs: 10000, intervalMs: 200 });
  if (ok && insertText(host.editor(), fresh.text, { atEnd: true })) Toast.show(Lang.t('summary.done.inserted'), { ms: 7000 });
}

function buildSettingsSection() {
  const root = h('div');
  const input = h('input', { cls: 'gl-input', attrs: { type: 'number', min: '30', max: '95', step: '5', 'aria-label': Lang.t('summary.settings.hintAt') } });
  input.value = String(settings().hintAt);
  input.addEventListener('keydown', (e) => e.stopPropagation());
  input.addEventListener('change', () => Store.update('summary', (v) => void (v.hintAt = Number(input.value))));
  input.addEventListener('blur', () => (input.value = String(settings().hintAt))); // show the clamped value
  const reset = h('button', { cls: 'gl-btn gl-btn--small', attrs: { type: 'button' }, text: Lang.t('summary.settings.reset') });
  reset.addEventListener('click', () => {
    Store.update('summary', (v) => {
      v.prompt = '';
      v.intro = '';
    });
    Toast.show(Lang.t('summary.settings.resetDone'));
  });
  const hintLabel = h('label', { text: Lang.t('summary.settings.hintAt') });
  hintLabel.append(infoIcon(Lang.t('summary.settings.hintAt.info')));
  const resetRow = h('div', { attrs: { style: 'display:flex;align-items:center;gap:2px' }, children: [reset, infoIcon(Lang.t('summary.settings.reset.info'))] });
  root.append(h('div', { cls: 'gl-field', children: [hintLabel, input] }), resetRow);
  return root;
}
registerSettingsSection({ id: 'summary', order: 25, title: () => Lang.t('summary.settings.title'), build: buildSettingsSection });

/** @type {import('../../core/app.js').Feature} */
export const summarizeFeature = {
  id: 'summarize',
  zones: [],
  init() {
    void consumeHandoff();
  },
  teardown() {
    running?.abort();
    closeChainBar();
    Modal.closeAll();
  },
};

