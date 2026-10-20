/**
 * Locale detection + string lookup.
 *
 * Detection (first match wins): Gemini's own <html lang> (the language the
 * person chose for the site), then navigator.language, then English.
 * Missing keys fall back to English, then to the key itself, so a gap is at
 * worst an English string - never a crash.
 */
import { bus } from '../core/events.js';
import en from './en.js';
import ar from './ar.js';
import ru from './ru.js';
import zhCN from './zh-CN.js';

const DICTS = { en, ar, ru, 'zh-CN': zhCN };
const RTL_LOCALES = new Set(['ar']);

export const SUPPORTED_LOCALES = Object.keys(DICTS);

function pick(raw) {
  const l = String(raw || '').toLowerCase();
  if (l.startsWith('zh')) return 'zh-CN';
  if (l.startsWith('ru')) return 'ru';
  if (l.startsWith('ar')) return 'ar';
  if (l.startsWith('en')) return 'en';
  return null;
}

function detect() {
  return pick(document.documentElement.getAttribute('lang')) || pick(navigator.language) || 'en';
}

let current = null;
const ruleCache = new Map();

export const Lang = {
  locale() {
    return (current ??= detect());
  },

  isRtl() {
    return RTL_LOCALES.has(this.locale());
  },

  /** Re-detect; emits 'locale' when the page language changed. */
  sync() {
    const next = detect();
    if (current !== null && next === current) return false;
    const changed = current !== null;
    current = next;
    if (changed) bus.emit('locale', { locale: next });
    return changed;
  },

  /** t('key', { name: 'x' }) - placeholders are replaced literally (no `$` surprises). */
  t(key, vars) {
    const table = DICTS[this.locale()] || en;
    let str = table[key] ?? en[key] ?? key;
    if (vars) {
      str = str.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
    }
    return str;
  },

  /** Pluralized lookup: keys `base.one` / `base.few` / … with `{n}`. */
  plural(base, n, vars) {
    const locale = this.locale();
    let rules = ruleCache.get(locale);
    if (!rules) ruleCache.set(locale, (rules = new Intl.PluralRules(locale)));
    const table = DICTS[locale] || en;
    const category = rules.select(n);
    const key = `${base}.${category}` in table ? `${base}.${category}` : `${base}.other`;
    return this.t(key, { n, ...vars });
  },

  /** @internal for tests */
  _reset() {
    current = null;
  },
};
