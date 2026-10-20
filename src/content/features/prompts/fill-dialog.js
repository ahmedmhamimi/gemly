/**
 * The form shown before a template is inserted or a chain is run: one field per
 * variable (text box, or dropdown for {{name:a|b}}), defaults filled in, and a live
 * preview of exactly what will be inserted / sent.
 */
import { Lang } from '../../i18n/index.js';
import { Modal } from '../../ui/modal.js';
import { h } from '../../util/dom.js';
import { truncate } from '../../util/text.js';
import { defaultValues, render } from './template.js';

/**
 * @param {{ title: string, variables: import('./template.js').Variable[], steps: string[], chain: boolean,
 *           remembered?: Record<string,string>, tooMany?: boolean }} o
 * @returns {Promise<Record<string,string>|null>} the values, or null when cancelled
 */
export function askValues({ title, variables, steps, chain, remembered = {}, tooMany = false }) {
  return new Promise((resolve) => {
    const values = { ...defaultValues(variables), ...Object.fromEntries(Object.entries(remembered).filter(([k]) => variables.some((v) => v.name === k))) };
    let submitted = false;

    const content = h('div');
    const modal = Modal.open({
      title,
      content,
      width: 520,
      onClose: () => {
        if (!submitted) resolve(null);
      },
    });

    const ctx = () => ({ locale: Lang.locale(), now: new Date() });
    const preview = chain ? h('ol', { cls: 'gl-list gl-tpl-steps' }) : h('pre', { cls: 'gl-tpl-preview', attrs: { dir: 'auto' } });
    const drawPreview = () => {
      if (chain) preview.replaceChildren(...steps.map((s) => h('li', { text: truncate(render(s, values, ctx()).replace(/\s+/g, ' '), 200), attrs: { dir: 'auto' } })));
      else preview.textContent = truncate(render(steps[0], values, ctx()), 600);
    };

    const fields = variables.map((v, i) => {
      const id = `gl-tpl-${i}`;
      let control;
      if (v.kind === 'select') {
        control = h('select', { cls: 'gl-select', attrs: { id }, children: v.options.map((o) => h('option', { attrs: { value: o }, text: o })) });
        control.value = values[v.name] && v.options.includes(values[v.name]) ? values[v.name] : v.default;
        values[v.name] = control.value;
      } else {
        control = h('textarea', { cls: 'gl-input gl-tpl-input', attrs: { id, rows: v.default.includes('\n') ? '3' : '2', dir: 'auto' } });
        control.value = values[v.name] ?? '';
      }
      control.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) go.click();
      });
      const onChange = () => {
        values[v.name] = control.value;
        drawPreview();
      };
      control.addEventListener(v.kind === 'select' ? 'change' : 'input', onChange);
      if (i === 0) control.setAttribute('autofocus', '');
      return h('div', { cls: 'gl-field', children: [h('label', { attrs: { for: id }, text: v.name }), control] });
    });

    const go = h('button', { cls: 'gl-btn gl-btn--primary', attrs: { type: 'button' }, text: chain ? Lang.t('tpl.run', { n: steps.length }) : Lang.t('tpl.insert') });
    const cancel = h('button', { cls: 'gl-btn', attrs: { type: 'button' }, text: Lang.t('prompts.form.cancel') });
    go.addEventListener('click', () => {
      submitted = true;
      resolve({ ...values });
      modal.close();
    });
    cancel.addEventListener('click', () => modal.close());

    content.append(
      ...(chain ? [h('p', { cls: 'gl-modal__hint', text: Lang.t('tpl.chain.hint', { n: steps.length }) })] : []),
      ...fields,
      ...(tooMany ? [h('p', { cls: 'gl-modal__hint', text: Lang.t('tpl.tooMany') })] : []),
      h('div', { cls: 'gl-modal__section', text: Lang.t(chain ? 'tpl.preview.steps' : 'tpl.preview') }),
      preview,
      h('div', { cls: 'gl-modal__foot', attrs: { style: 'padding:10px 0 0;border:0' }, children: [cancel, go] }),
    );
    drawPreview();
  });
}
