/**
 * Writing into Gemini's prompt box.
 *
 * The composer is a rich-text (Quill) contenteditable, so there is no
 * `.value` to set. Text is inserted with the same editing commands a person
 * triggers by typing, which keeps the framework's own state in sync. Each
 * strategy is verified (did the text actually grow?) and the next one is
 * tried if not, so an insert never silently does nothing.
 */

export function placeCaretAtEnd(el) {
  el.focus({ preventScroll: true });
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

const textLength = (el) => (el.textContent || '').length;

/** Strategy 1: real editing commands, one paragraph per line. */
function viaCommands(editor, text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (i > 0 && !document.execCommand('insertParagraph')) return false;
    if (lines[i] && !document.execCommand('insertText', false, lines[i])) return false;
  }
  return true;
}

/** Strategy 2: synthetic paste, which rich editors handle natively. */
function viaPaste(editor, text) {
  try {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    editor.dispatchEvent(event);
    return event.defaultPrevented; // an editor that handled it prevents default
  } catch {
    return false;
  }
}

/** Strategy 3: write the DOM directly and announce it. */
function viaDom(editor, text) {
  const frag = document.createDocumentFragment();
  text.split('\n').forEach((line) => {
    const p = document.createElement('p');
    if (line) p.textContent = line;
    else p.appendChild(document.createElement('br'));
    frag.appendChild(p);
  });
  const first = editor.firstElementChild;
  if (first && first.tagName === 'P' && !first.textContent && editor.children.length === 1) {
    editor.replaceChildren(frag); // empty placeholder paragraph
  } else {
    editor.appendChild(frag);
  }
  editor.classList.remove('ql-blank');
  editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  return true;
}

/**
 * @param {HTMLElement} editor
 * @param {string} text
 * @param {{ atEnd?: boolean, range?: Range|null }} [opts]
 * @returns {boolean} whether the text ended up in the editor
 */
export function insertText(editor, text, { atEnd = false, range = null } = {}) {
  if (!editor || !text) return false;

  if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
    const proto = editor.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    const next = editor.value + text;
    if (setter) setter.call(editor, next);
    else editor.value = next;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  editor.focus({ preventScroll: true });
  if (range && range.commonAncestorContainer.isConnected && editor.contains(range.commonAncestorContainer)) {
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  } else if (atEnd || !window.getSelection()?.rangeCount || !editor.contains(window.getSelection().anchorNode)) {
    placeCaretAtEnd(editor);
  }

  for (const strategy of [viaCommands, viaPaste, viaDom]) {
    const before = textLength(editor);
    let ran;
    try {
      ran = strategy(editor, text);
    } catch {
      ran = false;
    }
    if (ran && (textLength(editor) > before || strategy === viaPaste)) {
      if (strategy === viaPaste && textLength(editor) <= before) continue;
      return true;
    }
  }
  return false;
}
