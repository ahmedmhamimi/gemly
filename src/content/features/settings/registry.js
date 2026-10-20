/**
 * Settings sections. A feature that needs a place in the Settings dialog
 * registers a section; the settings feature itself never changes.
 *
 * @typedef {Object} SettingsSection
 * @property {string} id
 * @property {number} order
 * @property {() => string} title                    localised heading
 * @property {(ctx: { close: () => void }) => HTMLElement} build   called each time the dialog opens
 */
import { Features } from '../../core/feature-registry.js';

/** @type {SettingsSection[]} */
const sections = [];

export function registerSettingsSection(section) {
  if (sections.some((s) => s.id === section.id)) throw new Error(`Duplicate settings section "${section.id}"`);
  sections.push(section);
  sections.sort((a, b) => a.order - b.order);
}

/** Sections whose owning feature is on. */
export const settingsSections = () => Features.filterFacets('section', sections);

/** Every registered id, on or off (manifest test). */
export const registeredSettingsSectionIds = () => sections.map((s) => s.id);
