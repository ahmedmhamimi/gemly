/**
 * Central icon set (inline SVG, currentColor). One place to restyle or add an
 * icon; features call icon('name', size) instead of embedding SVG strings.
 * All shapes are static trusted strings - no page data is ever interpolated.
 */
const P = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-3.6-3.6"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v11A1.5 1.5 0 0 0 5.5 18H8"/>',
  copyPlain: '<rect x="8" y="8" width="12" height="13" rx="2.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v11A1.5 1.5 0 0 0 5.5 18H8"/><path d="M11 13h6M11 16.5h4" stroke-width="1.5"/>',
  download: '<path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19.5h14"/>',
  check: '<path d="M5 13l4 4L19 7" stroke-width="2.3"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" stroke-width="2.2"/>',
  plus: '<path d="M12 5v14M5 12h14" stroke-width="2.2"/>',
  chevronDown: '<path d="M6 9l6 6 6-6" stroke-width="2.6"/>',
  chevronRight: '<path d="M9 6l6 6-6 6" stroke-width="2.6"/>',
  chevronUp: '<path d="M6 15l6-6 6 6" stroke-width="2.2"/>',
  sparkle: '<path d="M12 3l2.2 6.3 6.3 2.2-6.3 2.2L12 20l-2.2-6.3-6.3-2.2 6.3-2.2z"/>',
  folder: '<path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h3.6a2 2 0 0 1 1.5.7l1 1.1a2 2 0 0 0 1.5.7h5.4a2 2 0 0 1 2 2V17.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  folderPlus: '<path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h3.6l2 2h7.4a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/>',
  bookmark: '<path d="M6.5 3.5h11a1 1 0 0 1 1 1V20l-6.5-4.2L5.5 20V4.5a1 1 0 0 1 1-1z"/>',
  library: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/><path d="M9.5 8h5M9.5 11.5h3"/>',
  pdf: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 13h6M9 17h4"/>',
  json: '<path d="M9 4c-2 0-2.5 1-2.5 2.5v2.5c0 1-.6 2-2 3 1.4 1 2 2 2 3v2.5C6.5 19 7 20 9 20"/><path d="M15 4c2 0 2.5 1 2.5 2.5V9c0 1 .6 2 2 3-1.4 1-2 2-2 3v2.5C17.5 19 17 20 15 20"/>',
  text: '<path d="M5 6h14M5 11h14M5 16h9"/>',
  edit: '<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  archive: '<path d="M4 7h16v3H4z"/><path d="M5.5 10v8.5A1.5 1.5 0 0 0 7 20h10a1.5 1.5 0 0 0 1.5-1.5V10"/><path d="M10 14h4"/>',
  tag: '<path d="M3.5 12.2V4.5h7.7l9 9a1.5 1.5 0 0 1 0 2.1l-5.6 5.6a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8" cy="9" r="1.2"/>',
  checklist: '<path d="M4 6.5l1.6 1.6L8.5 5M4 12.5l1.6 1.6 2.9-3.1M4 18.5l1.6 1.6 2.9-3.1M12 7h8M12 13h8M12 19h8"/>',
  user: '<circle cx="12" cy="8.5" r="3.6"/><path d="M4.5 20c.9-3.6 3.8-5.6 7.5-5.6s6.6 2 7.5 5.6"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>',
  play: '<path d="M8 5.5v13l11-6.5z"/>',
  code: '<path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5M13.5 5l-3 14"/>',
  star: '<path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/>',
  compress: '<path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5" stroke-width="2"/><path d="M12 7.6h.01" stroke-width="2.4"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2.2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
};

const FILLED = {
  more: '<circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/>',
};

const SPINNER =
  '<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="2" stroke-opacity="0.25" fill="none"/><path d="M20.5 12a8.5 8.5 0 0 0-8.5-8.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.7s" repeatCount="indefinite"/></path>';

/**
 * @param {keyof typeof P | 'spinner' | 'more'} name
 * @param {number} [size]
 * @param {{ fill?: string, stroke?: string }} [opts] fill/stroke override (used for coloured folder icons)
 */
export function icon(name, size = 16, opts = {}) {
  const attrs = `width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"`;
  if (name === 'spinner') return `<svg ${attrs}>${SPINNER}</svg>`;
  if (name === 'more') return `<svg ${attrs} fill="currentColor">${FILLED.more}</svg>`;
  const body = P[name];
  if (!body) return '';
  const fill = opts.fill ? `fill="${opts.fill}" fill-opacity="0.22"` : 'fill="none"';
  const stroke = opts.stroke || 'currentColor';
  return `<svg ${attrs} ${fill} stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
