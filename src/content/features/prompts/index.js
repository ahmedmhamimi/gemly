/**
 * Prompt library: reusable prompt snippets launched from the bar. A searchable
 * list; clicking one inserts it into the prompt box where the caret was.
 * Add / edit / delete happen inline. Defaults are seeded once, the first time
 * the library opens (never re-added after the person deletes everything).
 *
 * Templates: {{variables}} (text, defaults, dropdowns) are filled in through a
 * form first (template.js, fill-dialog.js). Chains: extra steps are sent one
 * after another, each after the previous answer is complete (chain.js).
 * The whole library imports/exports as JSON (transfer.js).
 */
import { CONFIG, IDS } from '../../core/config.js';
import { bus } from '../../core/events.js';
import { Features } from '../../core/feature-registry.js';
import { MAX_CHAIN_STEPS } from '../../core/schema.js';
import { Store } from '../../core/store.js';
import { GeminiHost as host } from '../../host/gemini.js';
import { Lang } from '../../i18n/index.js';
import { iconButton } from '../../ui/flash.js';
import { icon } from '../../ui/icons.js';
import { Popover } from '../../ui/popover.js';
import { Toast } from '../../ui/toast.js';
import { insertText } from '../../util/editor.js';
import { cleanLabel, escapeHtml, truncate, uid } from '../../util/text.js';
import { registerBarWidget } from '../bar/registry.js';
import { downloadTextFile } from '../export/formats.js';
import { closeChainBar, showChainBar } from './chain-bar.js';
import { makeChainSender, runChain } from './chain.js';
import { askValues } from './fill-dialog.js';
import { analyze, isChain, promptSteps, render } from './template.js';
import { buildExport, MAX_IMPORT_BYTES, mergePersonas, mergePrompts, parseImport } from './transfer.js';

/** Library state for the currently open panel. */
const view = { search: '', editingId: null, adding: false, panel: null, savedRange: null };

function allPrompts() {
  let list = Store.get('prompts');
  if (list === null) {
    list = Store.set(
      'prompts',
      CONFIG.prompts.defaults.map((p) => ({ ...p, id: uid('p'), createdAt: Date.now() })),
    );
  }
  return list;
}

const matches = (p) => {
  const q = view.search.trim().toLowerCase();
  return !q || p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q);
};

function rememberCaret() {
  const sel = window.getSelection();
  const editor = host.editor();
  view.savedRange = sel?.rangeCount && editor?.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
}

function insertPrompt(content) {
  const editor = host.editor();
  if (!editor) {
    Toast.show(Lang.t('prompts.findBoxFailed'));
    return false;
  }
  const ok = insertText(editor, content, { range: view.savedRange, atEnd: !view.savedRange });
  if (!ok) Toast.show(Lang.t('prompts.findBoxFailed'));
  else bus.emit('activity', { kind: 'prompt' });
  return ok;
}

/** Last answers per prompt, for this page session only (a form should remember what you just typed). */
const lastValues = new Map();
let chainAbort = null;

const chainEnabled = () => Features.isEnabled('prompt-chains');

/** Insert a prompt, asking for its {{variables}} first; run it as a chain when it has follow-up steps. */
async function usePrompt(prompt) {
  const chain = isChain(prompt) && chainEnabled();
  const texts = chain ? promptSteps(prompt) : [prompt.content];
  const { variables, tooMany } = analyze(texts);
  let values = {};
  if (variables.length || chain) {
    values = await askValues({ title: prompt.title || Lang.t('prompts.untitled'), variables, steps: texts, chain, remembered: lastValues.get(prompt.id), tooMany });
    if (!values) return;
    lastValues.set(prompt.id, values);
  }
  const ctx = { locale: Lang.locale(), now: new Date() };
  const rendered = texts.map((t) => render(t, values, ctx));
  if (chain) await startChain(rendered);
  else insertPrompt(rendered[0]);
}

async function startChain(steps) {
  if (chainAbort) return void Toast.show(Lang.t('chain.busy'));
  const editor = host.editor();
  if (!editor) return void Toast.show(Lang.t('prompts.findBoxFailed'));
  if (host.editorText(editor).trim()) return void Toast.show(Lang.t('chain.needsEmpty'));
  const ac = new AbortController();
  chainAbort = ac;
  const bar = showChainBar({ total: steps.length, onStop: () => ac.abort() });
  bus.emit('activity', { kind: 'prompt' });
  let res;
  try {
    res = await runChain({
      steps,
      signal: ac.signal,
      send: makeChainSender({ host, insert: insertText }),
      onStep: ({ index, state }) => bar.update(index, state),
    });
  } finally {
    bar.close();
    chainAbort = null;
  }
  if (res.error) Toast.show(Lang.t(`chain.error.${res.error}`, { n: res.completed + 1, total: res.total }), { ms: 6000 });
  else if (res.cancelled) Toast.show(Lang.t('chain.stopped', { n: res.completed, total: res.total }));
  else Toast.show(Lang.t('chain.done', { n: res.total }));
}

function buildForm(prompt) {
  const form = document.createElement('div');
  form.className = 'gl-prompt-form';
  form.innerHTML =
    `<input class="gl-input" type="text" maxlength="${CONFIG.prompts.maxTitleLength}" placeholder="${escapeHtml(Lang.t('prompts.form.titlePlaceholder'))}">` +
    `<textarea class="gl-input" maxlength="${CONFIG.prompts.maxContentLength}" placeholder="${escapeHtml(Lang.t('prompts.form.contentPlaceholder'))}"></textarea>` +
    '<div class="gl-prompt-steps"></div>' +
    `<div class="gl-prompt-form__hint">${escapeHtml(Lang.t('prompts.form.syntax'))}</div>` +
    '<div class="gl-prompt-form__btns"></div>';
  const [title, content] = form.querySelectorAll(':scope > input, :scope > textarea');
  const stepsBox = form.querySelector('.gl-prompt-steps');
  title.value = prompt?.title || '';
  content.value = prompt?.content || '';
  [title, content].forEach((el) => el.addEventListener('keydown', (e) => e.stopPropagation()));

  // Follow-up steps (a chain). Step 1 is the main text above.
  const stepEls = [];
  const addStepBtn = document.createElement('button');
  addStepBtn.type = 'button';
  addStepBtn.className = 'gl-btn gl-btn--small';
  const refreshAdd = () => {
    addStepBtn.textContent = Lang.t('prompts.form.addStep', { n: stepEls.length + 2 });
    addStepBtn.hidden = stepEls.length >= MAX_CHAIN_STEPS || !chainEnabled();
  };
  const addStep = (text = '') => {
    const row = document.createElement('div');
    row.className = 'gl-prompt-step';
    const ta = document.createElement('textarea');
    ta.className = 'gl-input';
    ta.maxLength = CONFIG.prompts.maxContentLength;
    ta.value = text;
    ta.addEventListener('keydown', (e) => e.stopPropagation());
    const rm = iconButton({ iconName: 'close', tip: Lang.t('prompts.form.removeStep'), size: 14 });
    const renumber = () => stepEls.forEach((el, i) => (el.placeholder = Lang.t('prompts.form.stepPlaceholder', { n: i + 2 })));
    rm.addEventListener('click', (e) => {
      e.preventDefault();
      stepEls.splice(stepEls.indexOf(ta), 1);
      row.remove();
      renumber();
      refreshAdd();
    });
    row.append(ta, rm);
    stepsBox.appendChild(row);
    stepEls.push(ta);
    renumber();
    refreshAdd();
    return ta;
  };
  (prompt?.steps || []).forEach((t) => addStep(t));
  addStepBtn.addEventListener('click', () => addStep().focus());
  refreshAdd();

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
  save.textContent = Lang.t(prompt ? 'prompts.form.save' : 'prompts.form.add');
  save.addEventListener('click', () => {
    const body = content.value.slice(0, CONFIG.prompts.maxContentLength);
    if (!body.trim()) return content.focus();
    const name = cleanLabel(title.value, CONFIG.prompts.maxTitleLength) || cleanLabel(body, 40);
    const steps = stepEls.map((el) => el.value.slice(0, CONFIG.prompts.maxContentLength)).filter((t) => t.trim());
    if (prompt) {
      Store.update('prompts', (list) => {
        const p = list.find((x) => x.id === prompt.id);
        if (!p) return;
        Object.assign(p, { title: name, content: body });
        if (steps.length) p.steps = steps;
        else delete p.steps;
      });
    } else {
      Store.update('prompts', (list) => void list.unshift({ id: uid('p'), title: name, content: body, ...(steps.length ? { steps } : {}), createdAt: Date.now() }));
      bus.emit('activity', { kind: 'prompt' });
    }
    view.editingId = null;
    view.adding = false;
    renderList();
  });
  form.querySelector('.gl-prompt-form__btns').append(addStepBtn, cancel, save);
  return form;
}

function buildRow(prompt) {
  const row = document.createElement('div');
  row.className = 'gl-prompt-row';
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.dataset.glTip = Lang.t('prompts.row.title');
  const nVars = analyze(promptSteps(prompt)).variables.length;
  const badges =
    (nVars ? `<span class="gl-prompt-row__badge" title="${escapeHtml(Lang.t('prompts.badge.vars.title'))}">{ } ${nVars}</span>` : '') +
    (isChain(prompt) ? `<span class="gl-prompt-row__badge" title="${escapeHtml(Lang.t('prompts.badge.chain.title'))}">${icon('play', 10)} ${prompt.steps.length + 1}</span>` : '');
  row.innerHTML =
    `<div class="gl-prompt-row__main"><div class="gl-prompt-row__title" dir="auto">${escapeHtml(prompt.title || Lang.t('prompts.untitled'))}${badges}</div>` +
    `<div class="gl-prompt-row__snippet" dir="auto">${escapeHtml(truncate(prompt.content.replace(/\s+/g, ' ').trim(), CONFIG.prompts.snippetLength))}</div></div>` +
    '<div class="gl-prompt-row__tools"></div>';
  const tools = row.querySelector('.gl-prompt-row__tools');

  const edit = iconButton({ iconName: 'edit', tip: Lang.t('prompts.edit.title'), size: 14 });
  edit.addEventListener('click', (e) => {
    e.stopPropagation();
    view.editingId = prompt.id;
    view.adding = false;
    renderList();
  });
  const del = iconButton({ iconName: 'trash', tip: Lang.t('prompts.delete.title'), size: 14 });
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    Store.update('prompts', (list) => list.filter((p) => p.id !== prompt.id));
    renderList();
  });
  tools.append(edit, del);

  const use = () => {
    Popover.closeAll();
    void usePrompt(prompt);
  };
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
  const all = allPrompts();
  const shown = all.filter((p) => matches(p) || p.id === view.editingId);
  const nodes = [];
  if (view.adding) nodes.push(buildForm(null));
  if (!shown.length && !view.adding) {
    const empty = document.createElement('div');
    empty.className = 'gl-prompts__empty';
    empty.textContent = Lang.t(all.length ? 'prompts.search.noMatch' : 'prompts.empty');
    nodes.push(empty);
  }
  shown.forEach((p) => nodes.push(p.id === view.editingId ? buildForm(p) : buildRow(p)));
  list.replaceChildren(...nodes);
  Popover.current()?.reposition();
}

function exportLibrary() {
  const json = JSON.stringify(buildExport({ prompts: allPrompts(), personas: Store.get('personas') }), null, 2);
  downloadTextFile(json, `gemly-prompts-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
  Toast.show(Lang.t('prompts.export.done'));
}

async function importLibrary(input) {
  const f = input.files?.[0];
  input.value = '';
  if (!f) return;
  if (f.size > MAX_IMPORT_BYTES) return void Toast.show(Lang.t('prompts.import.err.size'));
  let parsed;
  try {
    parsed = parseImport(await f.text());
  } catch {
    return void Toast.show(Lang.t('prompts.import.err.json'));
  }
  if (!parsed.ok) return void Toast.show(Lang.t(`prompts.import.err.${parsed.error}`));
  const p = mergePrompts(allPrompts(), parsed.prompts, () => uid('p'));
  Store.set('prompts', p.list);
  const a = mergePersonas(Store.get('personas').items, parsed.personas, () => uid('a'));
  if (a.added) Store.update('personas', (s) => void (s.items = a.items));
  renderList();
  Toast.show(Lang.t('prompts.import.done', { added: p.added, personas: a.added, skipped: p.duplicates + a.duplicates + parsed.skipped }), { ms: 5000 });
}

function open(anchor) {
  Object.assign(view, { search: '', editingId: null, adding: false });
  const panel = document.createElement('div');
  panel.id = IDS.promptBtn + '-panel';
  panel.className = 'gl-ui gl-pop gl-pop--glass gl-prompts';
  panel.innerHTML =
    `<div class="gl-prompts__top"><div class="gl-prompts__title-row"><span class="gl-pop__title">${escapeHtml(Lang.t('prompts.panel.title'))}</span></div>` +
    `<input class="gl-input gl-prompts__search" type="text" placeholder="${escapeHtml(Lang.t('prompts.search.placeholder'))}"></div>` +
    '<div class="gl-prompts__list gl-scroll"></div><div class="gl-prompts__foot"></div>';
  view.panel = panel;

  const search = panel.querySelector('.gl-prompts__search');
  search.addEventListener('input', () => {
    view.search = search.value;
    renderList();
  });
  search.addEventListener('keydown', (e) => e.stopPropagation());

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'gl-prompts__add';
  add.innerHTML = `${icon('plus', 13)}${escapeHtml(Lang.t('prompts.add.title'))}`;
  add.addEventListener('click', () => {
    view.adding = true;
    view.editingId = null;
    renderList();
    panel.querySelector('.gl-prompt-form input')?.focus();
  });
  const foot = panel.querySelector('.gl-prompts__foot');
  const exportBtn = iconButton({ iconName: 'download', tip: Lang.t('prompts.export.title'), size: 14 });
  exportBtn.addEventListener('click', exportLibrary);
  const importBtn = iconButton({ iconName: 'upload', tip: Lang.t('prompts.import.title'), size: 14 });
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.json,application/json';
  file.hidden = true;
  file.addEventListener('change', () => void importLibrary(file));
  importBtn.addEventListener('click', () => file.click());
  foot.append(add, exportBtn, importBtn, file);

  renderList();
  Popover.open({
    anchor,
    content: panel,
    onClose: () => {
      view.panel = null;
    },
  });
  search.focus();
}

registerBarWidget({
  id: 'prompts',
  order: 20,
  build() {
    const btn = iconButton({ id: IDS.promptBtn, iconName: 'library', tip: Lang.t('prompts.button.title') });
    // Remember the caret BEFORE the press moves focus away from the editor.
    btn.addEventListener('pointerdown', rememberCaret);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const cur = Popover.current();
      if (cur?.anchor === btn) cur.close();
      else open(btn);
    });
    return btn;
  },
});

/** @type {import('../../core/app.js').Feature} */
export const promptsFeature = {
  id: 'prompts',
  zones: [],
  init(ctx) {
    // Another tab edited the library while this panel is open.
    ctx.onDispose(bus.on('store', ({ names }) => names.includes('prompts') && renderList()));
  },
  teardown() {
    view.panel = null;
    chainAbort?.abort();
    closeChainBar();
  },
};
