/**
 * Tone picker: a chip in the bar + a short, ALWAYS VISIBLE tag appended to the
 * outgoing prompt (e.g. "Tone: Fun 🎉"). Never hidden or stripped - what you
 * see in the chat, in exports and in the request Gemini receives is the same.
 *
 * The tag is only added when the tone CHANGES within a conversation (Gemini
 * remembers it from history), including changing to "Off". "Already told
 * Gemini" is committed only once the send is CONFIRMED (a new user turn
 * appears), so a send Gemini refuses never marks the tone as delivered.
 */
import { CONFIG, IDS } from '../../core/config.js';
import { bus } from '../../core/events.js';
import { Store } from '../../core/store.js';
import { Popover } from '../../ui/popover.js';
import { icon } from '../../ui/icons.js';
import { Lang } from '../../i18n/index.js';
import { GeminiHost as host } from '../../host/gemini.js';
import { cleanLabel, escapeHtml, uid } from '../../util/text.js';
import { insertText } from '../../util/editor.js';
import { registerBarWidget } from '../bar/registry.js';
import { registerSendHook } from '../composer/send-hooks.js';

const isPreset = (tone) => CONFIG.tone.presets.some((p) => p.id === tone.id);

const allTones = () => [...CONFIG.tone.presets, ...Store.get('tone').customTones];
const selectedTone = () => allTones().find((t) => t.id === Store.get('tone').selectedId) || CONFIG.tone.presets[0];
const toneLabel = (tone) => (tone.id === 'none' ? Lang.t('tone.option.off') : isPreset(tone) ? Lang.t(`tone.preset.${tone.id}`) : tone.label);
const tagText = (tone) =>
  tone.id === 'none'
    ? Lang.t('tone.tagOff')
    : Lang.t('tone.tag', { label: `${toneLabel(tone)}${tone.emoji ? ' ' + tone.emoji : ''}` });

// ---- delivery tracking ------------------------------------------------------

/** @type {{ toneId: string, at: number, userCountBefore: number } | null} */
let pending = null;
/** Tone sent in a brand-new chat (no URL id yet), to be filed once the URL gets an id. */
let awaitingId = null;

const lastDelivered = (convId) => (convId ? Store.get('toneLast')[convId] : undefined);

function needsInjection() {
  const tone = selectedTone();
  const last = lastDelivered(host.currentConversationId());
  return tone.id === 'none' ? last !== undefined && last !== 'none' : last !== tone.id;
}

function commit(convId, toneId) {
  if (convId) Store.update('toneLast', (m) => void (m[convId] = toneId));
}

function inject(editor, userCount) {
  const tone = selectedTone();
  const tag = tagText(tone);
  const current = host.editorText(editor);
  if (!current.trim()) return false;
  if (!current.includes(tag)) {
    if (!insertText(editor, (current.endsWith('\n') ? '\n' : '\n\n') + tag, { atEnd: true })) return false;
  }
  pending = { toneId: tone.id, at: Date.now(), userCountBefore: userCount };
  return true;
}

registerSendHook({
  id: 'tone',
  prepare(editor) {
    if (!needsInjection()) return false;
    const count = host.turns().filter((t) => host.isUserTurn(t)).length;
    return inject(editor, count);
  },
});

// ---- chip + popover -----------------------------------------------------------

function sync(chip) {
  const tone = selectedTone();
  const active = tone.id !== 'none';
  const label = toneLabel(tone);
  chip.dataset.active = String(active);
  chip.dataset.glTip = active ? Lang.t('tone.chip.active.title', { label }) : Lang.t('tone.chip.off.title');
  chip.innerHTML =
    (tone.emoji ? `<span class="gl-chip__emoji">${tone.emoji}</span>` : icon('sparkle', 15)) +
    `<span class="gl-chip__label">${escapeHtml(active ? label : Lang.t('tone.chip.label'))}</span>` +
    `<span class="gl-chip__chev">${icon('chevronDown', 10)}</span>`;
}

function select(id) {
  Store.update('tone', (s) => void (s.selectedId = id));
  if (id !== 'none') bus.emit('activity', { kind: 'tone' });
}

function buildOption(tone, onChange) {
  const selected = tone.id === Store.get('tone').selectedId;
  const option = document.createElement('div');
  option.className = 'gl-tone-option';
  option.setAttribute('role', 'button');
  option.tabIndex = 0;
  option.dataset.selected = String(selected);
  option.dataset.glTip = tone.id === 'none' ? Lang.t('tone.option.off.title') : Lang.t('tone.option.title', { tag: tagText(tone) });
  option.innerHTML =
    `<span class="gl-tone-option__emoji">${tone.id === 'none' ? '&mdash;' : tone.emoji || '\u{1F4AC}'}</span>` +
    `<span class="gl-tone-option__label">${escapeHtml(toneLabel(tone))}</span>`;
  const pick = () => {
    select(tone.id);
    onChange();
  };
  option.addEventListener('click', pick);
  option.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick();
    }
  });
  if (!isPreset(tone)) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'gl-tone-option__remove';
    remove.textContent = '\u00d7';
    remove.setAttribute('aria-label', Lang.t('tone.remove.title'));
    remove.dataset.glTip = Lang.t('tone.remove.title');
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      Store.update('tone', (s) => {
        s.customTones = s.customTones.filter((t) => t.id !== tone.id);
        if (s.selectedId === tone.id) s.selectedId = 'none';
      });
      onChange();
    });
    option.appendChild(remove);
  }
  return option;
}

function openPopover(chip) {
  const pop = document.createElement('div');
  pop.className = 'gl-ui gl-pop gl-pop--glass gl-tone-pop';
  pop.innerHTML =
    `<div class="gl-pop__head"><span class="gl-pop__title">${escapeHtml(Lang.t('tone.popover.title'))}</span></div>` +
    `<div class="gl-pop__hint">${escapeHtml(Lang.t('tone.popover.hint'))}</div>` +
    '<div class="gl-tone-grid gl-scroll"></div><div class="gl-tone-foot"></div>';
  const grid = pop.querySelector('.gl-tone-grid');
  const foot = pop.querySelector('.gl-tone-foot');

  const redraw = () => {
    grid.replaceChildren(...allTones().map((t) => buildOption(t, redraw)));
    sync(chip);
  };

  const showAdd = () => {
    foot.replaceChildren();
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'gl-tone-add-btn';
    addBtn.innerHTML = `${icon('plus', 12)}<span>${escapeHtml(Lang.t('tone.add'))}</span>`;
    addBtn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'gl-input';
      input.placeholder = Lang.t('tone.add.placeholder');
      input.maxLength = CONFIG.tone.maxCustomLength;
      foot.replaceChildren(input);
      input.focus();
      let settled = false;
      const finish = (commitValue) => {
        if (settled) return;
        settled = true;
        const label = cleanLabel(input.value, CONFIG.tone.maxCustomLength);
        if (commitValue && label) {
          const tone = { id: uid('t'), label, emoji: '' };
          Store.update('tone', (s) => {
            s.customTones.push(tone);
            s.selectedId = tone.id;
          });
          bus.emit('activity', { kind: 'tone' });
        }
        showAdd();
        redraw();
      };
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
      });
      input.addEventListener('blur', () => finish(!!input.value.trim()));
    });
    foot.appendChild(addBtn);
  };

  redraw();
  showAdd();
  Popover.open({ anchor: chip, content: pop });
}

registerBarWidget({
  id: 'tone',
  order: 10,
  build() {
    const chip = document.createElement('button');
    chip.id = IDS.toneChip;
    chip.type = 'button';
    chip.className = 'gl-ui gl-chip';
    sync(chip);
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = Popover.current();
      if (open?.anchor === chip) open.close();
      else openPopover(chip);
    });
    return chip;
  },
  update(chip) {
    sync(chip);
  },
});

/** @type {import('../../core/app.js').Feature} */
export const toneFeature = {
  id: 'tone',
  zones: ['chat'],
  init(ctx) {
    // A new chat has no URL id until the first reply: file the tone then.
    ctx.onDispose(
      bus.on('navigate', () => {
        const id = host.currentConversationId();
        if (awaitingId && id) {
          commit(id, awaitingId);
          awaitingId = null;
        } else if (!id) {
          awaitingId = null;
        }
        if (pending && Date.now() - pending.at > CONFIG.tone.sendConfirmMs) pending = null;
      }),
    );
  },
  scan(scan) {
    if (!pending) return;
    const userCount = scan.turns.filter((t) => host.isUserTurn(t)).length;
    if (userCount > pending.userCountBefore) {
      const convId = host.currentConversationId();
      if (convId) commit(convId, pending.toneId);
      else awaitingId = pending.toneId;
      pending = null;
    } else if (Date.now() - pending.at > CONFIG.tone.sendConfirmMs) {
      pending = null; // the send never happened
    }
  },
  teardown() {
    pending = awaitingId = null;
  },
};
