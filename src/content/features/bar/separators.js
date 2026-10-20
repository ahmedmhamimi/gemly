import { registerBarWidget } from './registry.js';

const sep = (id, order) =>
  registerBarWidget({
    id,
    order,
    build() {
      const s = document.createElement('span');
      s.className = 'gl-bar__sep';
      s.setAttribute('aria-hidden', 'true');
      return s;
    },
  });

sep('sep-1', 25);
sep('sep-2', 45);
