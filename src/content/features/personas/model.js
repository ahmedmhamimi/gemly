/** Persona (custom-instruction profile) operations. Everything goes through the Store. */
import { Store } from '../../core/store.js';
import { cleanLabel, uid } from '../../util/text.js';

export const LIMITS = Object.freeze({ name: 60, text: 8000, items: 50 });

export const listPersonas = () => Store.get('personas').items;
export const activePersona = () => {
  const { items, activeId } = Store.get('personas');
  return items.find((p) => p.id === activeId) || null;
};

/** @returns {object|null} the new persona, or null when the text is empty or the library is full */
export function addPersona({ name, text }) {
  const body = String(text ?? '').slice(0, LIMITS.text);
  if (!body.trim() || Store.get('personas').items.length >= LIMITS.items) return null;
  const persona = { id: uid('a'), name: cleanLabel(name, LIMITS.name) || cleanLabel(body, 30), text: body, createdAt: Date.now() };
  Store.update('personas', (s) => void s.items.push(persona));
  return persona;
}

export function updatePersona(id, { name, text }) {
  const body = String(text ?? '').slice(0, LIMITS.text);
  if (!body.trim()) return false;
  let found = false;
  Store.update('personas', (s) => {
    const p = s.items.find((x) => x.id === id);
    if (!p) return;
    found = true;
    p.name = cleanLabel(name, LIMITS.name) || cleanLabel(body, 30);
    p.text = body;
  });
  return found;
}

export function deletePersona(id) {
  Store.update('personas', (s) => {
    s.items = s.items.filter((p) => p.id !== id);
    if (s.activeId === id) s.activeId = null;
  });
}

export const setActivePersona = (id) => Store.update('personas', (s) => void (s.activeId = id && s.items.some((p) => p.id === id) ? id : null));
export const setAutoSend = (on) => Store.update('personas', (s) => void (s.autoSend = !!on));
