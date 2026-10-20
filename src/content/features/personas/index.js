/**
 * Personas: saved custom-instruction profiles (name + text). One click starts a new
 * chat and inserts the persona as the first message (optionally sending it); a second
 * button inserts it into the current chat. The popover doubles as the quick switcher
 * (the last applied persona is marked) and opens with Alt+Shift+P.
 */
import { IDS } from '../../core/config.js';
import { bus } from '../../core/events.js';
import { sleep } from '../../core/jobs.js';
import { Store } from '../../core/store.js';
import { GeminiHost as host } from '../../host/gemini.js';
import { Lang } from '../../i18n/index.js';
import { iconButton } from '../../ui/flash.js';
import { icon } from '../../ui/icons.js';
import { Popover } from '../../ui/popover.js';
import { Toast } from '../../ui/toast.js';
import { insertText } from '../../util/editor.js';
import { openFreshChat } from '../../util/new-chat.js';
import { escapeHtml, truncate } from '../../util/text.js';
import { registerBarWidget } from '../bar/registry.js';
import { activePersona, addPersona, deletePersona, listPersonas, LIMITS, setActivePersona, setAutoSend, updatePersona } from './model.js';

const view = { editingId: null, adding: false, panel: null };

async function applyPersona(persona, { newChat }) {
  Popover.closeAll();
  setActivePersona(persona.id);
  if (newChat && !(await openFreshChat(host))) return void Toast.show(Lang.t('persona.newChatFailed'));
  const editor = host.editor();
  if (!editor) return void Toast.show(Lang.t('prompts.findBoxFailed'));
  if (!insertText(editor, persona.text, { atEnd: true })) return void Toast.show(Lang.t('prompts.findBoxFailed'));
  bus.emit('activity', { kind: 'prompt' });
  if (Store.get('personas').autoSend) {
    await sleep(200);
    const btn = host.sendButton();
    if (btn && host.canSend(btn)) btn.click();
    else Toast.show(Lang.t('persona.sendFailed'));
  } else {
    Toast.show(Lang.t('persona.inserted', { name: persona.name }));
  }
}

function buildForm(persona) {
  const form = document.createElement('div');
  form.className = 'gl-prompt-form';
  form.innerHTML =
    `<input class="gl-input" type="text" maxlength="${LIMITS.name}" placeholder="${escapeHtml(Lang.t('persona.form.name'))}">` +
    `<textarea class="gl-input" maxlength="${LIMITS.text}" placeholder="${escapeHtml(Lang.t('persona.form.text'))}"></textarea>` +
    '<div class="gl-prompt-form__btns"></div>';
  const [name, text] = form.querySelectorAll('input, textarea');
  name.value = persona?.name || '';
  text.value = persona?.text || '';
  [name, text].forEach((el) => el.addEventListener('keydown', (e) => e.stopPropagation()));
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'gl-btn';
  cancel.textContent = Lang.t('prompts.form.cancel');
  cancel.addEventListener('click', () => {
    view.editingId = null;
    view.adding = false;
    renderList();
  });
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'gl-btn gl-btn--primary';
  save.textContent = Lang.t(persona ? 'prompts.form.save' : 'prompts.form.add');
  save.addEventListener('click', () => {
    if (!text.value.trim()) return text.focus();
    const ok = persona ? updatePersona(persona.id, { name: name.value, text: text.value }) : !!addPersona({ name: name.value, text: text.value });
    if (!ok) return void Toast.show(Lang.t('persona.full', { max: LIMITS.items }));
    view.editingId = null;
    view.adding = false;
    renderList();
  });
  form.querySelector('.gl-prompt-form__btns').append(cancel, save);
  return form;
}

function buildRow(p) {
  const row = document.createElement('div');
  row.className = 'gl-prompt-row';
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.dataset.glTip = Lang.t('persona.row.title');
  const active = activePersona()?.id === p.id;
  row.innerHTML =
    `<div class="gl-prompt-row__main"><div class="gl-prompt-row__title" dir="auto">${active ? `${icon('check', 12)} ` : ''}${escapeHtml(p.name)}</div>` +
    `<div class="gl-prompt-row__snippet" dir="auto">${escapeHtml(truncate(p.text.replace(/\s+/g, ' ').trim(), 110))}</div></div>` +
    '<div class="gl-prompt-row__tools"></div>';
  const tools = row.querySelector('.gl-prompt-row__tools');
  const here = iconButton({ iconName: 'plus', tip: Lang.t('persona.here.title'), size: 14 });
  here.addEventListener('click', (e) => {
    e.stopPropagation();
    void applyPersona(p, { newChat: false });
  });
  const edit = iconButton({ iconName: 'edit', tip: Lang.t('prompts.edit.title'), size: 14 });
  edit.addEventListener('click', (e) => {
    e.stopPropagation();
    view.editingId = p.id;
    view.adding = false;
    renderList();
  });
  const del = iconButton({ iconName: 'trash', tip: Lang.t('prompts.delete.title'), size: 14 });
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    deletePersona(p.id);
    renderList();
  });
  tools.append(here, edit, del);
  const use = () => void applyPersona(p, { newChat: true });
  row.addEventListener('click', use);
  row.addEventListener('keydown', (e) => {
    if (e.target === row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      use();
    }
  });
  return row;
}

function renderList() {
  const list = view.panel?.querySelector('.gl-prompts__list');
  if (!list) return;
  const all = listPersonas();
  const nodes = [];
  if (view.adding) nodes.push(buildForm(null));
  if (!all.length && !view.adding) {
    const empty = document.createElement('div');
    empty.className = 'gl-prompts__empty';
    empty.textContent = Lang.t('persona.empty');
    nodes.push(empty);
  }
  all.forEach((p) => nodes.push(p.id === view.editingId ? buildForm(p) : buildRow(p)));
  list.replaceChildren(...nodes);
  Popover.current()?.reposition();
}

function open(anchor) {
  Object.assign(view, { editingId: null, adding: false });
  const panel = document.createElement('div');
  panel.className = 'gl-ui gl-pop gl-pop--glass gl-prompts';
  panel.innerHTML =
    `<div class="gl-prompts__top"><div class="gl-prompts__title-row"><span class="gl-pop__title">${escapeHtml(Lang.t('persona.panel.title'))}</span></div>` +
    `<p class="gl-modal__hint" style="margin:4px 0 0">${escapeHtml(Lang.t('persona.panel.hint'))}</p></div>` +
    '<div class="gl-prompts__list gl-scroll"></div><div class="gl-prompts__foot"></div>';
  view.panel = panel;

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'gl-prompts__add';
  add.innerHTML = `${icon('plus', 13)}${escapeHtml(Lang.t('persona.add.title'))}`;
  add.addEventListener('click', () => {
    view.adding = true;
    view.editingId = null;
    renderList();
    panel.querySelector('.gl-prompt-form input')?.focus();
  });
  const auto = document.createElement('label');
  auto.className = 'gl-check';
  auto.style.marginInlineStart = 'auto';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = Store.get('personas').autoSend;
  box.addEventListener('change', () => setAutoSend(box.checked));
  auto.append(box, Object.assign(document.createElement('span'), { textContent: Lang.t('persona.autoSend') }));
  panel.querySelector('.gl-prompts__foot').append(add, auto);

  renderList();
  Popover.open({ anchor, content: panel, onClose: () => (view.panel = null) });
}

function refreshButton() {
  const btn = document.getElementById(IDS.personaBtn);
  if (!btn) return;
  const a = activePersona();
  btn.dataset.glTip = a ? `${Lang.t('persona.button.title')}: ${a.name}` : Lang.t('persona.button.title');
  btn.toggleAttribute('data-active', !!a);
}

registerBarWidget({
  id: 'personas',
  order: 15,
  build() {
    const btn = iconButton({ id: IDS.personaBtn, iconName: 'user', tip: `${Lang.t('persona.button.title')} (Alt+Shift+P)` });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const cur = Popover.current();
      if (cur?.anchor === btn) cur.close();
      else open(btn);
    });
    queueMicrotask(refreshButton);
    return btn;
  },
});

/** @type {import('../../core/app.js').Feature} */
export const personasFeature = {
  id: 'personas',
  zones: [],
  init(ctx) {
    ctx.onDispose(bus.on('store', ({ names }) => {
      if (!names.includes('personas')) return;
      refreshButton();
      renderList();
    }));
    // Quick switcher: Alt+Shift+P (no Ctrl/Meta, so it cannot collide with browser or Gemini shortcuts).
    ctx.listen(document, 'keydown', (e) => {
      if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyP') {
        const btn = document.getElementById(IDS.personaBtn);
        if (!btn) return;
        e.preventDefault();
        btn.click();
      }
    });
  },
  teardown() {
    view.panel = null;
  },
};
