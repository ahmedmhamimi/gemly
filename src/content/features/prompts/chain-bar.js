/**
 * Small floating status for a running chain: "Step 2 of 4" and a Stop button.
 * Not modal on purpose, so the conversation stays visible while it runs.
 */
import { Lang } from '../../i18n/index.js';
import { h } from '../../util/dom.js';

let bar = null;

export function showChainBar({ total, onStop }) {
  bar?.remove();
  const label = h('span', { cls: 'gl-chainbar__label' });
  const stop = h('button', { cls: 'gl-btn gl-btn--small gl-btn--danger', attrs: { type: 'button' }, text: Lang.t('chain.stop') });
  stop.addEventListener('click', () => {
    stop.disabled = true;
    label.textContent = Lang.t('chain.stopping');
    onStop();
  });
  bar = h('div', { cls: 'gl-ui gl-chainbar', attrs: { role: 'status', 'aria-live': 'polite' }, children: [label, stop] });
  document.body.appendChild(bar);
  const mine = bar;
  const update = (index, state) => {
    if (stop.disabled) return;
    label.textContent = Lang.t(state === 'done' ? 'chain.stepDone' : 'chain.step', { n: index + 1, total });
  };
  update(0, 'start');
  return {
    update,
    close() {
      mine.remove();
      if (bar === mine) bar = null;
    },
  };
}

export function closeChainBar() {
  bar?.remove();
  bar = null;
}

/** A floating status line with a Stop button for any long-running flow (e.g. summarize and continue). */
export function showStatusBar({ text, onStop }) {
  bar?.remove();
  const label = h('span', { cls: 'gl-chainbar__label', text });
  const stop = h('button', { cls: 'gl-btn gl-btn--small gl-btn--danger', attrs: { type: 'button' }, text: Lang.t('chain.stop') });
  stop.addEventListener('click', () => {
    stop.disabled = true;
    label.textContent = Lang.t('chain.stopping');
    onStop();
  });
  const mine = h('div', { cls: 'gl-ui gl-chainbar', attrs: { role: 'status', 'aria-live': 'polite' }, children: [label, stop] });
  bar = mine;
  document.body.appendChild(mine);
  return {
    setText(t) {
      if (!stop.disabled) label.textContent = t;
    },
    close() {
      mine.remove();
      if (bar === mine) bar = null;
    },
  };
}
