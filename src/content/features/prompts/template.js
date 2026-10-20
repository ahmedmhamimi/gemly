/**
 * Prompt templates (pure).
 *
 *   {{topic}}                 a text field
 *   {{topic=cooking}}         a text field with a default value
 *   {{tone:formal|casual}}    a dropdown (the first option is the default)
 *   {{date}} {{time}} {{datetime}}   filled in automatically, never asked
 *   \{{                        a literal "{{"
 *
 * A prompt chain shares one set of variables across all its steps, so the form
 * is shown once. Names are trimmed and case-sensitive. When a name appears more
 * than once the first default / option list wins; later ones only fill gaps.
 */

export const BUILTINS = Object.freeze(['date', 'time', 'datetime']);
export const LIMITS = Object.freeze({ variables: 20, nameChars: 40, options: 30, optionChars: 80, defaultChars: 500 });

const TOKEN = /\\\{\{|\{\{([^{}]{1,300}?)\}\}/g;
const NAME = /^[\p{L}\p{N}_ .-]{1,40}$/u;

/**
 * @typedef {{ name: string, kind: 'text'|'select', default: string, options: string[] }} Variable
 * @typedef {{ type: 'text', text: string } | { type: 'var', name: string, raw: string } | { type: 'builtin', name: string }} Segment
 */

/** Parse the inside of `{{ ... }}`. Returns null when it is not a valid placeholder (then it stays literal text). */
function parseBody(body) {
  const cut = body.search(/[=:]/);
  const name = (cut < 0 ? body : body.slice(0, cut)).trim();
  if (!name || !NAME.test(name) || name.length > LIMITS.nameChars) return null;
  if (BUILTINS.includes(name.toLowerCase())) return { builtin: name.toLowerCase() };
  if (cut < 0) return { name, kind: 'text', default: '', options: [] };
  const rest = body.slice(cut + 1);
  if (body[cut] === '=') return { name, kind: 'text', default: rest.trim().slice(0, LIMITS.defaultChars), options: [] };
  const options = [];
  for (const o of rest.split('|')) {
    const v = o.trim().slice(0, LIMITS.optionChars);
    if (v && !options.includes(v)) options.push(v);
    if (options.length >= LIMITS.options) break;
  }
  // One option is just a default; none is a plain field.
  return options.length >= 2
    ? { name, kind: 'select', default: options[0], options }
    : { name, kind: 'text', default: options[0] || '', options: [] };
}

/** @returns {Segment[]} */
export function parse(text) {
  const src = String(text ?? '');
  const out = [];
  let at = 0;
  const pushText = (t) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last?.type === 'text') last.text += t;
    else out.push({ type: 'text', text: t });
  };
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(src); m; m = TOKEN.exec(src)) {
    pushText(src.slice(at, m.index));
    at = m.index + m[0].length;
    if (m[0] === '\\{{') {
      pushText('{{');
      continue;
    }
    const p = parseBody(m[1]);
    if (!p) pushText(m[0]);
    else if (p.builtin) out.push({ type: 'builtin', name: p.builtin });
    else out.push({ type: 'var', name: p.name, def: p });
  }
  pushText(src.slice(at));
  return out;
}

/**
 * The variables to ask for, in order of first appearance, across one or more texts.
 * @param {string[]} texts
 * @returns {{ variables: Variable[], tooMany: boolean }}
 */
export function analyze(texts) {
  const byName = new Map();
  for (const text of texts) {
    for (const seg of parse(text)) {
      if (seg.type !== 'var') continue;
      const cur = byName.get(seg.name);
      if (!cur) byName.set(seg.name, { ...seg.def });
      else {
        if (!cur.default && seg.def.default) cur.default = seg.def.default;
        if (cur.kind === 'text' && seg.def.kind === 'select') Object.assign(cur, { kind: 'select', options: seg.def.options, default: cur.default || seg.def.default });
      }
    }
  }
  const all = [...byName.values()];
  return { variables: all.slice(0, LIMITS.variables), tooMany: all.length > LIMITS.variables };
}

function builtinValue(name, now, locale) {
  const d = now instanceof Date && !Number.isNaN(+now) ? now : new Date();
  try {
    if (name === 'date') return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(d);
    if (name === 'time') return new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(d);
    return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short' }).format(d);
  } catch {
    return d.toISOString();
  }
}

/**
 * @param {string} text
 * @param {Record<string, string>} values  by variable name; missing -> the default
 * @param {{ now?: Date, locale?: string }} [ctx]
 */
export function render(text, values = {}, { now, locale } = {}) {
  // Fallbacks come from the MERGED definitions (the first default wins), not from each occurrence.
  const defs = new Map(analyze([text]).variables.map((v) => [v.name, v]));
  return parse(text)
    .map((seg) => {
      if (seg.type === 'text') return seg.text;
      if (seg.type === 'builtin') return builtinValue(seg.name, now, locale);
      const v = Object.prototype.hasOwnProperty.call(values, seg.name) ? values[seg.name] : undefined;
      return typeof v === 'string' ? v : (defs.get(seg.name)?.default ?? seg.def.default);
    })
    .join('');
}

/** Initial form values: every variable at its default. */
export const defaultValues = (variables) => Object.fromEntries(variables.map((v) => [v.name, v.default]));

/** Does this prompt need a form? (any variable that is not a built-in) */
export const hasVariables = (texts) => analyze(texts).variables.length > 0;

/** The ordered texts of a prompt: its content, then its follow-up steps. */
export const promptSteps = (prompt) => [prompt.content, ...(Array.isArray(prompt.steps) ? prompt.steps : [])];

export const isChain = (prompt) => Array.isArray(prompt.steps) && prompt.steps.length > 0;
