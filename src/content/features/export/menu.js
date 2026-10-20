import { Popover } from '../../ui/popover.js';
import { icon } from '../../ui/icons.js';
import { Lang } from '../../i18n/index.js';
import { Features } from '../../core/feature-registry.js';
import { escapeHtml } from '../../util/text.js';

const FORMATS = [
  { format: 'pdf', icon: 'pdf', label: 'download.pdf.label', desc: 'download.pdf.desc' },
  { format: 'json', icon: 'json', label: 'download.json.label', desc: 'download.json.desc' },
  { format: 'txt', icon: 'text', label: 'download.txt.label', desc: 'download.txt.desc' },
  { format: 'md', icon: 'text', label: 'download.md.label', desc: 'download.md.desc' },
  { format: 'obsidian', icon: 'library', label: 'download.obsidian.label', desc: 'download.obsidian.desc' },
];

/**
 * Open the PDF/JSON/text chooser under `anchor`; `onChoose(format)` fires only
 * if the person picks one. Toggles closed if already open for this anchor.
 */
export function toggleDownloadMenu(anchor, onChoose) {
  const open = Popover.current();
  if (open && open.anchor === anchor) {
    open.close();
    return;
  }

  const menu = document.createElement('div');
  menu.className = 'gl-ui gl-pop gl-pop--glass gl-download-menu';
  menu.innerHTML = `<div class="gl-pop__label">${escapeHtml(Lang.t('download.as'))}</div>`;

  for (const f of FORMATS.filter((x) => !x.feature || Features.isEnabled(x.feature))) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'gl-menu-item';
    item.setAttribute('role', 'menuitem');
    item.innerHTML =
      `<span class="gl-menu-item__icon">${icon(f.icon, 18)}</span>` +
      `<span class="gl-menu-item__text"><span class="gl-menu-item__title">${escapeHtml(Lang.t(f.label))}</span>` +
      `<span class="gl-menu-item__desc">${escapeHtml(Lang.t(f.desc))}</span></span>`;
    item.addEventListener('click', () => {
      Popover.closeAll();
      onChoose(f.format);
    });
    menu.appendChild(item);
  }
  Popover.open({ anchor, content: menu, role: 'menu', align: 'end' });
}
