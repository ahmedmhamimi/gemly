/**
 * Host adapter for gemini.google.com - the ONLY file that knows Gemini's DOM.
 *
 * Everything else asks this adapter questions ("what are the chat turns?",
 * "where do the reply's action buttons live?") and never touches a Gemini
 * selector. When Gemini changes its markup, fix SELECTORS here; to support
 * another chat site, write a sibling adapter exposing the same methods.
 *
 * Every selector is an ORDERED FALLBACK LIST: the first that matches wins, so
 * adding a new fallback never breaks an old one.
 */
import { HOST_NAME } from '../core/config.js';
import { isOwn, queryAllFirst, queryFirst, visibleText } from '../util/dom.js';
import { Store } from '../core/store.js';

/**
 * Label of Gemini's "Delete" action in the interface languages we know. Used only
 * when its data-test-id is not found, and only on SHORT labels (see isDeleteLabel),
 * so a long sentence that happens to contain the word is never clicked.
 * "Remove" is deliberately not here: it also names harmless actions.
 */
const DELETE_WORDS = /\bdelete\b|удалить|删除|刪除|حذف|supprimer|eliminar|borrar|löschen|elimina\b|excluir|apagar|削除|삭제|\bsil\b|usuń|verwijder|ta bort|slett|poista|smazat|törlés|διαγραφ|מחק|हटाएं|\bhapus\b/i;

/** Is this button/menu text Gemini's delete action? */
export function isDeleteLabel(text, maxLength = 40) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > 0 && t.length <= maxLength && DELETE_WORDS.test(t);
}

export const SELECTORS = Object.freeze({
  // --- composer: Gemini's prompt box is a Quill contenteditable, not a <textarea>
  editor: [
    'input-area-v2 .ql-editor[contenteditable="true"]',
    'rich-textarea .ql-editor[contenteditable="true"]',
    '.ql-editor[contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
  ],
  sendButton: ['button.send-button', 'button[aria-label*="Send message" i]', 'button[aria-label="Send"]'],
  stopButton: [
    'button.send-button.stop',
    'button[aria-label*="Stop response" i]',
    'button[aria-label*="Stop generating" i]',
    'button.stop-icon',
  ],
  composerRoot: ['input-area-v2', '.input-area-container', 'input-container'],

  // --- conversation: one element per turn, in DOM order
  turns: 'user-query, model-response',
  turnsFallback: '.user-query-container, .response-container',
  userTurn: 'user-query, .user-query-container',
  userText: ['.query-text', '.user-query-bubble-with-background', '.query-content'],
  userTextLine: '.query-text-line',
  modelContent: ['message-content .markdown', 'message-content', '.markdown', '.model-response-text'],
  messageActions: 'message-actions',
  copyBtn: ['copy-button', 'button[aria-label*="Copy" i]'],
  userEditBtn: ['button[aria-label*="Edit" i]', '[data-test-id*="edit"]', 'button.edit-button', '.edit-button button'],

  // --- sidebar
  sidebar: ['bard-sidenav', 'side-navigation-content', 'mat-sidenav', 'nav'],
  conversationsList: ['conversations-list', '[data-test-id="conversations-list"]', '.conversations-container'],
  conversationLink: 'a[href*="/app/"], a[href*="/gem/"]',
  conversationTitle: ['.conversation-title', '[class*="conversation-title"]'],
  conversationRow: ['[data-test-id="conversation"]', '.conversation-container', '.conversation-items-container > *'],
  rowMenuButton: [
    '.conversation-actions-menu-button',
    'button[data-test-id="actions-menu-button"]',
    'button[aria-label*="actions" i]',
  ],
  renameMenuItem: ['[data-test-id="rename-button"]', 'button[aria-label*="Rename" i]'],
  dialogInput: [
    'mat-dialog-container input',
    '.mat-mdc-dialog-container input',
    '[role="dialog"] input[type="text"]',
    '[role="dialog"] input',
  ],
  overlayContainer: '.cdk-overlay-container',
  newChat: [
    '[data-test-id="new-chat-button"]',
    'a[aria-label*="New chat" i]',
    'button[aria-label*="New chat" i]',
    'side-nav-action-button a[href$="/app"]',
    'a[href="/app"]',
  ],
  deleteMenuItem: ['[data-test-id="delete-button"]', 'button[data-test-id*="delete" i]'],
  confirmDeleteButton: ['[data-test-id="confirm-button"]', 'button[data-test-id*="confirm" i]'],
  menuItems: ['[role="menuitem"]', 'button.mat-mdc-menu-item', '.mat-mdc-menu-item'],
  dialogs: ['mat-dialog-container', '[role="alertdialog"]', '[role="dialog"]'],
  /** The element whose scrolling loads older messages (infinite scroller). */
  chatScroller: ['infinite-scroller', '.chat-history', '[data-test-id="chat-history-container"]'],

  // --- mutation zones (see zoneOf)
  zoneSidebar: 'bard-sidenav, side-navigation-content, mat-sidenav',
  zoneComposer: 'input-area-v2, .input-area-container',
  zoneChat: 'infinite-scroller, .chat-history, user-query, model-response',
});

/** Page-language regex for the "Rename" menu item (fallback when no test id). */
const RENAME_TEXT = /rename|переимен|重命名|إعادة تسمية/i;

export const GeminiHost = {
  name: HOST_NAME,
  selectors: SELECTORS,

  // ------------------------------------------------------------------ routing

  /** `/app/<id>`, `/u/1/app/<id>`, `/gem/<gemId>/<id>` -> id, else null. */
  conversationId(href) {
    if (!href) return null;
    let path = String(href);
    try {
      path = new URL(path, location.origin).pathname;
    } catch {
      /* already a path */
    }
    const m = path.match(/^(?:\/u\/\d+)?\/(?:app|gem\/[^/]+)\/([a-zA-Z0-9_-]{6,})(?:\/|$)/);
    if (!m || /^(download|settings|library|activity)$/i.test(m[1])) return null;
    return m[1];
  },

  currentConversationId() {
    return this.conversationId(location.pathname);
  },

  pathOf(href) {
    try {
      return new URL(href, location.origin).pathname;
    } catch {
      return null;
    }
  },

  // ----------------------------------------------------------------- composer

  editor() {
    const el = queryFirst(SELECTORS.editor);
    return el && !isOwn(el) ? el : null;
  },

  /** The prompt's text ("" when empty). */
  editorText(editor = this.editor()) {
    if (!editor) return '';
    if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') return editor.value || '';
    // Do not trust Quill's `ql-blank` flag: the placeholder is CSS-only, so
    // the real text is authoritative (an empty editor is "" or a lone "\n").
    const raw = typeof editor.innerText === 'string' ? editor.innerText : editor.textContent || '';
    const text = raw.replace(/\u200b/g, '').replace(/\n$/, '');
    return text.trim() ? text : '';
  },

  composerRoot() {
    const editor = this.editor();
    if (!editor) return null;
    for (const sel of SELECTORS.composerRoot) {
      const root = editor.closest(sel);
      if (root) return root;
    }
    const host = editor.closest('rich-textarea') || editor;
    return host.parentElement?.parentElement?.parentElement || null;
  },

  /** True while a reply is streaming (the send button turns into "stop"). */
  isGenerating() {
    return !!queryFirst(SELECTORS.stopButton, this.composerRoot() || document);
  },

  sendButton() {
    const scope = this.composerRoot() || document;
    for (const sel of SELECTORS.sendButton) {
      const found = Array.from(scope.querySelectorAll(sel)).find((b) => !isOwn(b));
      if (found) return found;
    }
    return null;
  },

  /** True if `btn` is Gemini's (enabled, non-stop) send button. */
  isSendButton(btn) {
    if (!btn || isOwn(btn) || !SELECTORS.sendButton.some((s) => btn.matches(s))) return false;
    return !this.isStopButton(btn);
  },

  isStopButton(btn) {
    return SELECTORS.stopButton.some((s) => btn.matches(s));
  },

  canSend(btn = this.sendButton()) {
    return !!btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true' && !this.isStopButton(btn);
  },

  // ------------------------------------------------------------- conversation

  turns() {
    let list = document.querySelectorAll(SELECTORS.turns);
    if (!list.length) list = document.querySelectorAll(SELECTORS.turnsFallback);
    return Array.from(list);
  },

  turnSelector: `${SELECTORS.turns}, ${SELECTORS.turnsFallback}`,

  isUserTurn(el) {
    return !!el && el.matches(SELECTORS.userTurn);
  },

  userTextRoot(turn) {
    return queryFirst(SELECTORS.userText, turn);
  },

  assistantRoot(turn) {
    return queryFirst(SELECTORS.modelContent, turn);
  },

  /** Text of the part of the turn that carries the message. */
  userText(turn) {
    const node = this.userTextRoot(turn);
    if (node) {
      const lines = node.querySelectorAll(SELECTORS.userTextLine);
      if (lines.length) return Array.from(lines, (l) => visibleText(l)).join('\n').trim();
      return visibleText(node);
    }
    const clone = turn.cloneNode(true);
    clone.querySelectorAll('button, .cdk-visually-hidden, mat-icon').forEach((n) => n.remove());
    return (clone.textContent || '').trim();
  },

  /** Where Gemini's own per-reply buttons live: insert Gemly's cluster at `row`, after `after`. */
  actionAnchor(modelTurn) {
    const actions = modelTurn.querySelector(SELECTORS.messageActions);
    if (actions) {
      const copy = queryFirst(SELECTORS.copyBtn, actions);
      if (copy?.parentElement) return { row: copy.parentElement, after: copy };
      const btn = actions.querySelector('button');
      return btn?.parentElement ? { row: btn.parentElement, after: btn } : null;
    }
    // No wrapper: a Copy button that is NOT one of the per-code-block ones.
    const own = Array.from(modelTurn.querySelectorAll('button[aria-label*="Copy" i], copy-button')).find(
      (b) => !b.closest('code-block, .markdown, message-content, table-block'),
    );
    return own?.parentElement ? { row: own.parentElement, after: own } : null;
  },

  userEditButton(userTurn) {
    const scope = userTurn.closest('.conversation-container') || userTurn;
    for (const sel of SELECTORS.userEditBtn) {
      const hit = Array.from(scope.querySelectorAll(sel)).find((b) => !isOwn(b) && !b.closest('model-response'));
      if (hit) return hit;
    }
    return null;
  },

  // ------------------------------------------------------------------ sidebar

  sidebar() {
    return queryFirst(SELECTORS.sidebar);
  },

  conversationsList() {
    return queryFirst(SELECTORS.conversationsList);
  },

  /** Real chat links in the sidebar only (never chat-area links, never our rows). */
  sidebarLinks() {
    const scope = this.conversationsList() || this.sidebar();
    if (!scope) return [];
    return Array.from(scope.querySelectorAll(SELECTORS.conversationLink)).filter(
      (a) => !isOwn(a) && this.conversationId(a.getAttribute('href')),
    );
  },

  linkTitle(link) {
    const el = queryFirst(SELECTORS.conversationTitle, link);
    return (el?.textContent || link.getAttribute('aria-label') || link.textContent || '').trim();
  },

  /** The element representing one whole sidebar row (link + its "…" menu). */
  rowFor(link) {
    const list = this.conversationsList() || this.sidebar();
    const known = link.closest(SELECTORS.conversationRow.join(','));
    if (known && known !== list && list?.contains(known)) {
      if (known.querySelectorAll(SELECTORS.conversationLink).length <= 1) return known;
    }
    let node = link;
    for (let i = 0; i < 3; i++) {
      const parent = node.parentElement;
      if (!parent || parent === list) break;
      if (parent.querySelectorAll(SELECTORS.conversationLink).length > 1) break;
      node = parent;
    }
    return node;
  },

  /** Element above which Gemly's sidebar blocks (search + folders) are inserted. */
  sidebarAnchor() {
    const list = this.conversationsList();
    if (list?.parentElement) return list;
    const first = this.sidebarLinks()[0];
    return first ? this.rowFor(first).parentElement : null;
  },

  title() {
    const id = this.currentConversationId();
    if (id) {
      const link = this.sidebarLinks().find((a) => this.conversationId(a.getAttribute('href')) === id);
      const live = link && this.linkTitle(link);
      if (live) return live;
      const cached = Store.get('convMeta')[id]?.title;
      if (cached) return cached;
    }
    const tab = document.title.replace(/\s*[-\u2013\u00b7|]\s*(Google\s+)?Gemini\s*$/i, '').trim();
    if (tab && !/^(Google\s+)?Gemini$/i.test(tab)) return tab;
    const firstUser = this.turns().find((t) => this.isUserTurn(t));
    if (firstUser) {
      const snippet = this.userText(firstUser).replace(/\s+/g, ' ').slice(0, 60);
      if (snippet) return snippet;
    }
    return 'Gemini Conversation';
  },

  // ----------------------------------------------------------- quick actions

  findRenameItem() {
    const overlay = document.querySelector(SELECTORS.overlayContainer) || document;
    const byId = queryFirst(SELECTORS.renameMenuItem, overlay);
    if (byId) return byId.closest('button, [role="menuitem"]') || byId;
    const items = overlay.querySelectorAll('[role="menuitem"], button');
    return Array.from(items).find((el) => RENAME_TEXT.test(el.textContent || '')) || null;
  },

  dialogInput() {
    return queryFirst(SELECTORS.dialogInput);
  },

  rowMenuButton(row, link) {
    return queryFirst(SELECTORS.rowMenuButton, row) || queryFirst(SELECTORS.rowMenuButton, link);
  },

  // ------------------------------------------------- driving the page (bulk jobs)

  /** Nearest ancestor-or-self that really scrolls vertically. */
  scrollableAncestor(el) {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) return n;
    }
    return null;
  },

  /** What to scroll to load more sidebar chats (null when nothing scrolls). */
  sidebarScroller() {
    const list = this.conversationsList() || this.sidebar();
    return list ? this.scrollableAncestor(list) : null;
  },

  /** What to scroll to the top to load older messages of the open chat. */
  chatScroller() {
    const hit = queryFirst(SELECTORS.chatScroller);
    if (hit) return this.scrollableAncestor(hit) || (hit.scrollHeight > hit.clientHeight ? hit : null);
    const first = this.turns()[0];
    return first ? this.scrollableAncestor(first) : null;
  },

  /** Open a chat by clicking its sidebar link (Gemini's own SPA navigation). @returns {boolean} found */
  openConversation(id) {
    const link = this.sidebarLinks().find((a) => this.conversationId(a.getAttribute('href')) === id);
    if (!link) return false;
    link.click();
    return true;
  },

  // ------------------------------------------------ deleting chats (Gemini's own UI)

  /** The sidebar link of a chat, or null when its row is not loaded. */
  linkFor(id) {
    return this.sidebarLinks().find((a) => this.conversationId(a.getAttribute('href')) === id) || null;
  },

  /** The "..." button of this chat's sidebar row, or null (reuses the folders feature's lookup). */
  chatMenuButton(link) {
    const row = this.rowFor(link);
    const btn = row && this.rowMenuButton(row, link);
    return btn && !isOwn(btn) ? btn : null;
  },

  /** The open menu's "Delete" entry, or null. Only looks inside Gemini's overlay layer. */
  deleteMenuItem() {
    const layer = queryFirst(SELECTORS.overlayContainer);
    if (!layer) return null;
    const exact = queryFirst(SELECTORS.deleteMenuItem, layer);
    if (exact) return exact;
    return queryAllFirst(SELECTORS.menuItems, layer).find((el) => isDeleteLabel(el.textContent)) || null;
  },

  /** The confirm button of an open delete dialog, or null. */
  confirmDeleteButton() {
    const layer = queryFirst(SELECTORS.overlayContainer);
    if (!layer) return null;
    const exact = queryFirst(SELECTORS.confirmDeleteButton, layer);
    if (exact) return exact;
    for (const sel of SELECTORS.dialogs) {
      for (const dlg of layer.querySelectorAll(sel)) {
        if (isOwn(dlg)) continue;
        const hit = [...dlg.querySelectorAll('button')].reverse().find((b) => isDeleteLabel(b.textContent, 30));
        if (hit) return hit;
      }
    }
    return null;
  },

  /** Close any menu/dialog Gemini has open (after something unexpected). */
  closeOverlays() {
    const target = document.activeElement || document.body;
    for (const type of ['keydown', 'keyup']) {
      target.dispatchEvent(new KeyboardEvent(type, { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
    }
    document.querySelector(`${SELECTORS.overlayContainer} .cdk-overlay-backdrop`)?.click();
  },

  /** Is this chat absent from the sidebar's list? */
  isChatGone(id) {
    return !this.sidebarLinks().some((a) => this.conversationId(a.getAttribute('href')) === id);
  },

  /** Start a new chat the way a person would. @returns {boolean} found */
  openNewChat() {
    const el = queryFirst(SELECTORS.newChat);
    if (!el || isOwn(el)) return false;
    el.click();
    return true;
  },

  /** Plain list of the chats the sidebar currently shows: [{ id, title, path }]. */
  chatList() {
    const seen = new Set();
    const out = [];
    for (const a of this.sidebarLinks()) {
      const id = this.conversationId(a.getAttribute('href'));
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, title: this.linkTitle(a), path: this.pathOf(a.getAttribute('href')) });
    }
    return out;
  },

  // ------------------------------------------------------------------- zones

  /**
   * Which part of the page a DOM node lives in. Used to decide which
   * features need to re-run after a mutation: 'sidebar' | 'composer' | 'chat',
   * 'global' (a container holding several regions changed: re-run everything)
   * or 'other' (irrelevant to Gemly).
   */
  zoneOf(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    if (!el || typeof el.closest !== 'function') return 'global';
    if (el.closest(SELECTORS.zoneSidebar)) return 'sidebar';
    if (el.closest(SELECTORS.zoneComposer)) return 'composer';
    if (el.closest(SELECTORS.zoneChat)) return 'chat';
    // Outside every known region. If the node CONTAINS one (a container swap
    // on navigation) everything must re-run; otherwise it is irrelevant to
    // Gemly (header, overlays, tooltips…) and is ignored.
    return el.querySelector(`${SELECTORS.zoneSidebar}, ${SELECTORS.zoneComposer}, ${SELECTORS.zoneChat}`) ? 'global' : 'other';
  },

  /** For the diagnostics report: how many elements each selector list finds. */
  probe() {
    const report = {};
    for (const [name, sel] of Object.entries(SELECTORS)) {
      const list = Array.isArray(sel) ? sel : [sel];
      report[name] = list.map((s) => {
        try {
          return { selector: s, matches: document.querySelectorAll(s).length };
        } catch {
          return { selector: s, matches: -1 };
        }
      });
    }
    return report;
  },

  allFirst: queryAllFirst,
};
