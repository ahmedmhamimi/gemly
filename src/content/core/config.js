/**
 * Brand + every host-independent tunable.
 *
 * Gemini-specific selectors do NOT live here - they are in host/gemini.js,
 * so supporting another chat site means writing one more host adapter and
 * nothing in this file changes.
 */

export const BRAND_NAME = 'Gemly';
export const HOST_NAME = 'Gemini';

/** Marker attributes/classes that identify DOM created by Gemly. */
export const OWN = Object.freeze({
  /** Class on every root element Gemly injects (also scopes base CSS). */
  cls: 'gl-ui',
  /** Attribute on Shadow-DOM host elements (welcome / review surfaces). */
  hostAttr: 'data-gemly-host',
  /** Attribute for owned elements that cannot carry the class (anchors, etc). */
  ownedAttr: 'data-gemly-owned',
  /** One selector that matches any of the above. */
  selector: '.gl-ui, [data-gemly-host], [data-gemly-owned]',
});

export const IDS = Object.freeze({
  bar: 'gemly-bar',
  exportBtn: 'gemly-export-btn',
  copyConversationBtn: 'gemly-copy-conversation-btn',
  counter: 'gemly-char-counter',
  countSpan: 'gemly-char-count',
  renderStage: 'gemly-pdf-render-stage',
  contextMeter: 'gemly-context-meter',
  searchBar: 'gemly-chat-search',
  searchInput: 'gemly-search-input',
  searchCount: 'gemly-search-count',
  sidebarSearchBar: 'gemly-sidebar-search',
  sidebarSearchInput: 'gemly-sidebar-search-input',
  sidebarNone: 'gemly-sidebar-none',
  folderSection: 'gemly-folder-section',
  folderList: 'gemly-folder-list',
  folderAddBtn: 'gemly-folder-add-btn',
  toneChip: 'gemly-tone-chip',
  bookmarkDock: 'gemly-bookmark-dock',
  bookmarkBadge: 'gemly-bookmark-badge',
  bookmarkPanel: 'gemly-bookmark-panel',
  promptBtn: 'gemly-prompt-library-btn',
  settingsBtn: 'gemly-settings-btn',
  settingsDialog: 'gemly-settings-dialog',
  bulkBar: 'gemly-bulk-bar',
  personaBtn: 'gemly-persona-btn',
  savedBtn: 'gemly-saved-btn',
  summarizeBtn: 'gemly-summarize-btn',
  summarizeDialog: 'gemly-summarize-dialog',
  savedDialog: 'gemly-saved-dialog',
  searchBtn: 'gemly-gsearch-btn',
  searchDialog: 'gemly-gsearch-dialog',
  welcomeHost: 'gemly-welcome-host',
  reviewHost: 'gemly-review-host',
});

/** chrome.storage.local keys. The `-v1` suffix is the schema version. */
export const STORAGE_KEYS = Object.freeze({
  folders: 'gemly-folders-v1',
  assignments: 'gemly-folder-assignments-v1',
  convMeta: 'gemly-conv-meta-v1',
  folderState: 'gemly-folder-state-v1',
  tone: 'gemly-tone-v1',
  toneLast: 'gemly-tone-last-injected-v1',
  bookmarks: 'gemly-bookmarks-v1',
  prompts: 'gemly-prompts-v1',
  /** Summarize-and-continue settings: { prompt, intro, hintAt } (empty text = the localized default). */
  summary: 'gemly-summary-v1',
  /** One-shot text for the new chat, kept only if the page had to reload to open it: { text, at }. */
  handoff: 'gemly-handoff-v1',
  /** Text highlights with notes, per chat: { [convId]: [{ id, key, quote, occ, note, createdAt }] }. */
  highlights: 'gemly-highlights-v1',
  /** Personas (custom-instruction profiles): { items, activeId, autoSend }. */
  personas: 'gemly-personas-v1',
  /** Tags per chat: { [convId]: string[] } (bulk management). */
  chatTags: 'gemly-chat-tags-v1',
  /** Chats hidden inside the extension: { [convId]: { at, title, path } }. */
  archivedChats: 'gemly-archived-v1',
  /** Per-user feature switches: { [featureId]: false } (see core/feature-registry.js). */
  features: 'gemly-features-v1',
  /** Integer data-format version; see core/migrations.js. Absent = 1 (pre-migration installs). */
  schemaVersion: 'gemly-schema-version',
  debug: 'gemly-debug',
});

/** One-slot copy of the data as it was before the most recent migration ran. */
export const BACKUP_KEY = 'gemly-premigration-backup';

/** Keys owned by the background worker / review prompt (not in the Store). */
export const BG_KEYS = Object.freeze({
  welcomePending: 'gemly-welcome-pending-v1',
  reviewState: 'gemly-review-state-v1',
});

export const MSG = Object.freeze({
  claimWelcome: 'gemly:claim-welcome',
  loadVendor: 'gemly:load-vendor',
  /** Chat archive in the service worker: { type, op, args } -> { ok, ... } (background/archive.js). */
  archive: 'gemly:archive',
});

export const CONFIG = Object.freeze({
  charCounter: { warnAt: 4000, dangerAt: 20000 },

  /**
   * Rough chars-per-token by script. Tokenizers are far less efficient on
   * non-Latin text, so one flat ratio badly under-counts Arabic/CJK/etc.
   */
  tokens: {
    latin: 4,
    cyrillicGreek: 2.8,
    arabicHebrew: 2.6,
    indic: 1.6,
    thaiKhmer: 2,
    cjk: 1.5,
    emoji: 1.2,
    other: 3,
    code: 3,
  },

  /**
   * Gemini advertises a ~1M token window; the page never reports real usage,
   * so the meter is always labelled an estimate.
   */
  contextWindow: { limit: 1048576 },

  folders: {
    maxDepth: 8,
    maxNameLength: 48,
    palette: [
      { name: 'Blue', hex: '#4f7cff' },
      { name: 'Purple', hex: '#8a6bff' },
      { name: 'Green', hex: '#22c55e' },
      { name: 'Orange', hex: '#f97316' },
      { name: 'Red', hex: '#ef4444' },
      { name: 'Pink', hex: '#ec4899' },
      { name: 'Teal', hex: '#14b8a6' },
      { name: 'Gray', hex: '#6b7280' },
    ],
  },

  tone: {
    maxCustomLength: 24,
    presets: [
      { id: 'none', label: 'Off', emoji: '' },
      { id: 'friendly', label: 'Friendly', emoji: '😊' },
      { id: 'fun', label: 'Fun', emoji: '🎉' },
      { id: 'professional', label: 'Professional', emoji: '👔' },
      { id: 'concise', label: 'Concise', emoji: '✂️' },
      { id: 'empathetic', label: 'Empathetic', emoji: '💛' },
    ],
    /**
     * How long after a send we wait for the new user turn to appear before
     * deciding the send never happened and forgetting the pending tone.
     */
    sendConfirmMs: 12000,
  },

  bookmarks: { snippetLength: 90, maxPerConversation: 500 },

  prompts: {
    snippetLength: 110,
    maxTitleLength: 80,
    maxContentLength: 20000,
    defaults: [
      { title: 'Explain simply', content: "Explain the following like I'm new to the topic. Use plain language and a short example:\n\n" },
      { title: 'Improve my writing', content: 'Improve the clarity, grammar, and flow of the following text, keeping its original meaning and tone:\n\n' },
      { title: 'Summarize', content: 'Summarize the key points below as a short bulleted list:\n\n' },
      { title: 'Find the bug', content: "Here is some code that isn't behaving as expected. Find the bug, explain why it happens, and show the fix:\n\n" },
      { title: 'Pros and cons', content: 'List the strongest pros and cons of the following, in balanced, concise bullet points:\n\n' },
    ],
  },

  /**
   * Chrome Web Store identity. Intentionally EMPTY: while no review URL is
   * set the review prompt stays dormant, and no feedback/survey link exists
   * anywhere in the extension.
   */
  store: { id: '', reviewsUrl: '', supportUrl: '' },

  review: {
    weights: { export: 3, bookmark: 2, folder: 2, prompt: 2, copy: 1, tone: 1 },
    minScore: 8,
    minActiveDays: 2,
    minDaysSinceInstall: 2,
    settleDelayMs: 2600,
    snoozeDays: [7, 21],
    maxAsks: 3,
    minGapBetweenAsksDays: 7,
  },

  scheduler: {
    /** Minimum gap between scans while idle / while Gemini is streaming. */
    idleIntervalMs: 120,
    streamingIntervalMs: 450,
    /**
     * Above this many mutation records in one batch we stop inspecting
     * records individually and treat the batch coarsely (see app.js).
     */
    maxRecordsInspected: 150,
    initialScanDelayMs: 900,
    /**
     * A feature that throws this many scans in a row is switched off for the
     * session instead of spamming errors forever.
     */
    maxConsecutiveFailures: 5,
  },

  storage: { flushDelayMs: 120 },

  pdf: {
    pageWidthPt: 595.28,
    pageHeightPt: 841.89,
    marginPt: 36,
    contentWidthPx: 760,
    renderScale: 2,
    jpegQuality: 0.92,
    blockSpacingPt: 8,
    /**
     * Browsers cap canvas size (Chrome ~16k px per side, plus a total-area
     * limit). Every raster pass is kept under these so long chats can never
     * silently produce a blank PDF.
     */
    maxCanvasHeightPx: 12000,
    maxChunkCssPx: 5200,
    /** Tall single elements are split so one block can never exceed a chunk. */
    maxCodeLinesPerPart: 140,
    maxTableRowsPerPart: 40,
  },

  search: { maxMatches: 2000, debounceMs: 160 },
});
