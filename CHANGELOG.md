# Changelog

Version numbers follow `package.json` (the build copies it into the manifest).

## Unreleased

Removed: Backup & export dialog (bulk export, restore, saved copies, merge), Sync between browsers, Export to
Notion (and the options page, `options_ui` and the optional Notion host permission). The extension has no network
features left. `folderPathOf` moved to `serialize/obsidian.js`; unused i18n keys and tests were removed.

Fixed:
- Dialog buttons (Remove / Save in the note dialog and every inline dialog footer) had no box: `.gl-modal__foot > *`
  was `display: contents`; it now applies to Modal's footer wrapper only. Remove is an outlined red button at the far side.
- Tooltips vanished after a moment: the safety poll compared a stale remembered mouse position. It now asks the browser
  whether the control is still hovered, and scrolling moves the tooltip instead of hiding it. Tooltips are above dialogs.
- The settings icon was a sun (circle with rays); it is a gear now.

Added: a small "i" next to every setting (all 29 feature switches, the summary threshold and reset, search-index rebuild)
with a plain-language explanation in en / ar / ru / zh-CN (`ui/info.js`, keys `feature.<id>.info`, ...). Hover, keyboard
focus or a tap shows it; a click does not toggle the switch. The ru / zh-CN / ar texts need native review.

## 1.1.0

Every feature of the 1.1.0 brief, built phase by phase on a new central feature registry. Each section below lists
what changed and the files touched; new modules are listed per phase. Test count: 31 existing jsdom-free tests at the
start, **290** at the end (plus the jsdom and browser suites, which need `npm install`).

### Phase 8: light sync (Feature 11) and Notion export (Feature 10)

**Light sync** (opt-in, off by default; `chrome.storage.sync`, no new permission)
- Syncs **only** settings (tone, feature switches, summary texts), prompts and personas. Chats, folders, bookmarks,
  highlights, notes and tags are never synced (a test checks that private data does not appear in the sync area).
- Respects Chrome's real limits: values are chunked to <= 7000 bytes per item (measured *including JSON escaping*), a
  95 KB total budget, <= 400 items. What does not fit is **skipped whole and reported**, never truncated; the rest still
  syncs; local data is never touched. A hard quota / rate error is reported as such in Settings.
- Runs in the **service worker** (once per browser, not once per tab), all state changes serialized through one queue
  (a two-device test caught a real lost-update race and a real undo bug). Conflicts: last writer wins per entry; on
  first contact prompts and personas are **merged** so enabling sync never discards what a device had.
- Settings > Sync: disclosure, switch, live status (last sync, usage of the 100 KB, skipped entries, quota/error), Sync
  now, "Remove my data from Chrome Sync". A toast with **Undo** appears when another browser overwrote something here.
- Files: `background/{sync-core,sync}.js`, `background/index.js`, `features/sync/index.js`, schema/store/config entries.
  Tests: `sync-core` (9), `sync` (12, two simulated devices sharing one fake sync area that enforces 8192 B / 102400 B / 512
  items), `sync-ui`.

**Notion export** (optional; `optional_host_permissions: https://api.notion.com/*`)
- Download menu > **Notion** sends the open chat to a page you choose, using **your own integration token**. The service worker
  does the request (CORS), converts the chat to Notion blocks honouring every documented limit (2000-char rich text, 100-element
  arrays, 100 blocks and ~300 KB per request, 2 nesting levels, tables, code languages mapped to values Notion accepts), paces
  requests to ~3/s, honours `Retry-After` (capped), retries 5xx, and maps 401/403/404/400/429/5xx/network to specific messages.
  A failure after the page was created reports the partial page and where it is.
- **Options page** (`options.html`, new): token, target page link or ID (parsed from any Notion URL), the permission prompt
  (needs a user click, which is why a page is required), test connection, remove token and permission. The token key is
  deliberately outside `STORAGE_KEYS`, so the content script never even reads it; it is never returned to a page and never synced.
- Files: `background/{notion,notion-config}.js`, `features/notion/{blocks,export}.js`, `src/options/index.js`,
  `static/options.{html,css}`, `static/manifest.json` (optional host permission + options_ui), `scripts/build.mjs` (options entry).
  Tests: `notion-blocks` (11), `notion` (10, injected fetch), manifest test pins the permission set.

**Quality tooling**: `i18n-usage` test (scans the source: every referenced key exists; dynamic key families complete,
mutation-tested), a TypeScript-based static check for undefined names / duplicate keys / unused symbols (see TESTING.md),
junk `_x` exports removed. ~45 i18n keys. content.js 406 KB (136 KB of it translations), background.js 41 KB, options.js 161 KB.


### Phase 7: summarize and continue (Feature 4)

- **Bar button** (and a one-time toast per chat) that nudges when a chat reaches a configurable share of the context window (default 70%, Settings > "Summarize and continue", range 30-95%). Computed independently of the context meter, which is unchanged.
- **Confirmation dialog with the editable summary request** (and the text placed before the summary in the new chat; both stored, an unchanged default stays "follow the UI language"). It explains exactly what will happen, because the flow sends a real message.
- **Flow**: types the request into Gemini's own prompt box and sends it, **waits until the answer has finished** (same engine as prompt chains), reads the answer as Markdown, opens a **fresh chat** and **pre-fills** (never sends) intro + summary. Floating status bar with **Stop**. No external API.
- Failure handling: nothing is sent if there is no chat; leaving the chat mid-way aborts; an empty/short answer is rejected; if SPA navigation to a new chat is impossible the text is stored for 2 minutes and inserted after a reload (`consumeHandoff`); if insertion fails the summary is copied to the clipboard.
- Shared `util/new-chat.js` (`openFreshChat`) now also used by personas (replacing inline code there); `showStatusBar` next to the chain bar.
- Data: Store entries `summary` and `handoff` (strict sanitizers, no migration). 28 i18n keys (4 languages). 7 new tests (242 in total). content.js 380 KB.

### Phase 6: code and table extraction (Feature 7), highlights and notes (Feature 8)

**Code & tables (per reply)**: a button that appears only on replies containing code or tables: **copy all code**, **download code as files** (extension from the language label: ~120 labels, Dockerfile/Makefile keep their names, content sniffing for shebangs/`<!doctype>`/`<?php`/JSON when the label is missing; several files arrive as one ZIP), **tables as CSV** (RFC 4180, UTF-8 BOM for Excel, **spreadsheet formula-injection neutralised** except plain numbers) and **tables as Excel (.xlsx)** with a dependency-free writer on the ZIP writer (bold header, numbers as numbers, leading zeros kept, text never stored as a formula; validated by loading it with openpyxl).

**Highlights and notes**
- Select text in a reply: a small toolbar offers **Highlight** and **Highlight + note**. Highlights are painted with the **CSS Custom Highlight API**, so nothing in Gemini's DOM is modified; they are stored as text and re-located on every repaint (whitespace- and node-boundary-insensitive, repeated phrases remembered by occurrence, repaint skipped unless something relevant changed).
- Starred messages are the existing bookmarks, which gain an optional **note**. A **Saved panel** (bar star button) lists them for this chat or all chats with search, inline note editing, go-to and remove.
- **Included in exports**: Markdown, Obsidian, HTML, JSON, plain text, PDF, the JSON backup and bulk export, and the search index (notes and quotes are searchable).
- Data: Store entry `highlights`; bookmark `note` (both additive); `ChatRecord.saved`. ~30 i18n keys. 24 new tests.
- Found while testing: `extract` and the per-reply download shared `order: 20` (relative order would have depended on import order); `extract` now has an explicit 25.


### Phase 5: prompt templates, chains, import/export (Feature 6) and personas (Feature 9)

**Prompt templates**
- Inline, portable syntax: `{{name}}` text field, `{{name=default}}`, `{{choice:a|b|c}}` dropdown (first option is the default), `{{date}}` / `{{time}}` / `{{datetime}}` filled automatically, `\{{` for a literal. The same name anywhere in a prompt (or chain) is asked once; first default wins; values are inserted literally (no re-expansion).
- A fill-in form (field per variable, remembered for the session, Ctrl/Cmd+Enter submits) with a live preview of exactly what will be inserted; rows show badges for variables and chain length.
- `render` bug found by its test and fixed: a later `{{who}}` ignored the first `{{who=World}}` default.

**Prompt chains** (feature `prompt-chains`)
- Extra steps per prompt (edited in the prompt form, up to 9 follow-ups). Running one shows a preview, then sends step 1, **waits until Gemini has actually finished answering** (reply started, then idle three polls in a row), then step 2, and so on, with a floating **Stop** button.
- Safety: needs an empty prompt box; any failed step ends the chain (later steps depend on earlier answers); a **navigation guard** refuses to send the next step if you opened a different chat (a new chat that gets its id after step 1 is handled); the tone send-hook still applies to each step because steps go through the normal Send button.

**Import / export**: footer buttons in the prompt library; portable JSON (no ids), strict validation, dedupe on merge (case/space-insensitive), 5 MB limit, personas included.

**Personas**: bar button + popover (also Alt+Shift+P): saved name + instruction; click = new chat and insert it as the first message (optionally "send right away"), "+" = add to the current chat; the last applied persona is marked (quick switcher). Store entry `personas` (strict sanitizer, cap 50).

- Data: `sanitizePrompts` keeps optional `steps` (additive, no migration). New Store entry `personas`.
- ~50 i18n keys (4 languages). 28 new jsdom-free tests (218 in total). Bundle: content.js 333 KB.

**Files touched**
`core/{config,schema,store}.js`, `features/prompts/index.js`, `features/manifest.js`, `ui/icons.js`, `styles/theme.css`, `i18n/*.js`; new: `features/prompts/{template,chain,chain-bar,fill-dialog,transfer}.js`, `features/personas/{model,index}.js`, tests `template`, `chain`, `prompt-transfer`, `personas`.

### Phase 4: bulk chat management (Feature 5)

**Added**
- **Selection mode in the sidebar** (a "Select chats" button under the filter box): checkboxes on every row, click or Space/Enter toggles, **Shift-click selects a range**, Esc leaves the mode; clicking a row selects it instead of opening the chat while the mode is on.
- **Move to folder** (existing or *new folder…* in the same dialog, or "no folder"), **tags** (comma-separated, up to 10 per chat; chips to remove; click a tag to filter the sidebar by it, and the existing sidebar filter now also matches tags), **archive** (chats are hidden *by this extension only*, with Undo, an "Archived (n)" manager with unarchive and a "show archived" switch).
- **Delete** through Gemini's own row menu -> Delete -> confirm: a confirmation dialog (count, first titles, an "I understand" checkbox, optional "also delete this extension's saved copies"), then progress, **Cancel**, and a per-chat failure report. A chat counts as deleted only when its row has actually disappeared. Anything that means the page is not what we expect (no menu button / no Delete item / unrecognised dialog) **stops the batch**, closes whatever is open and says which step failed. Deleted chats are removed from folders, tags and archive entries.
- `bulk-delete` is a separate feature id: it can be switched off while the rest stays.
- Store entries `chatTags` and `archivedChats` (strict sanitizers, no migration needed: additive). Host layer: `linkFor`, `chatMenuButton`, `deleteMenuItem`, `confirmDeleteButton`, `closeOverlays`, `isChatGone`, `isDeleteLabel` (multi-language, short labels only, "Remove" deliberately excluded).
- ~60 i18n keys (4 languages). 21 new jsdom-free tests (190 in total).

**Found and fixed while building (important)**
- My first host patch **overwrote the existing `rowMenuButton` selector list and method** that the folders feature uses (it would have broken the folders row menu). Caught by a `tsc --checkJs` pass for duplicate keys; the existing definitions are now reused. A second patch had silently not applied (an undefined `isDeleteLabel`); caught by the delete-job test. I now run a mechanical "undefined names / duplicate keys / bad imports" check after every phase (see TESTING.md).

**Files touched**
`core/{config,schema,store}.js`, `host/gemini.js`, `features/manifest.js`, `features/sidebar/search.js`, `ui/icons.js`, `ui/chat-picker.js` (comment), `styles/theme.css`, `i18n/*.js`; new: `features/bulk/{ops,selection,rows,delete-job,dialogs,index}.js`, tests `bulk-ops`, `delete-job`, `selection`.

### Phase 3: cross-chat search (Feature 3)

**Added**
- **Search dialog** (bar button or **Alt+Shift+F**): full-text search over every saved chat with **keyword, date range ("saved from/to") and folder filters**, highlighted snippets (up to two per chat, best messages first), highlighted titles, relevance ranking, arrow-key navigation, click to open (the sidebar link when it is loaded, otherwise the saved path). Queries run in the service worker, so typing never blocks the page; a newer keystroke supersedes an older answer.
- **Local index** in the service worker's IndexedDB (`postings`: token -> chat ids, `terms`: what each chat contributed). Incremental and idempotent (unchanged chats are skipped, changed ones diffed, deleted ones removed). AND across terms, prefix match on the last term, accent-insensitive (Latin/Cyrillic diacritics, Arabic harakat and alef forms), bigrams for Han/Hiragana/Katakana/Thai.
- **Automatic saving of chats you open** (feature `chat-index`): event-driven only (a few seconds after a chat opens or a reply finishes, never on a timer, never per mutation, skipped while generating or in a hidden tab). A possibly partial view of a long chat is **merged** into the stored copy (`mergeRecords`) instead of replacing it. Can be switched off in Settings > Features.
- **Settings > Search index**: how many chats are searchable, **Rebuild index** with progress and Cancel, privacy note.
- Archive DB schema v2 (adds the two stores; existing v1 data is kept). New archive operations `putSeen`, `search`, `indexStats`, `indexBatch`, `indexClear`.
- ~30 i18n keys (4 languages). 34 new jsdom-free tests (169 in total).

**Performance (synthetic archive: 1,000 chats x 60 messages)**: indexing ~15 ms per chat in the worker; typical query 20-60 ms, broad single-token prefix 110-370 ms. A first version spent three tokenizer passes per candidate; it now does one, plus an ASCII pre-check that provably cannot cause false negatives (tested).

**Files touched**
`core/{archive-client,config}.js`, `background/{archive,index}.js`, `features/manifest.js`, `styles/theme.css`, `i18n/*.js`; new: `background/{search-index,stores}.js`, `features/archive-search/{tokenize,merge-records,snippets,render,dialog,index,auto-index,settings-section}.js`, tests `tokenize`, `archive-search-pure`, `archive-search-ui`, `search-index`.

### Phase 2: full backup / bulk export / restore (Feature 1) and advanced export (Feature 2)

**Added**
- **Backup & export dialog** (bar button, feature `backup`): export *all sidebar chats*, *a folder (with subfolders)*, *chats you pick*, or *saved copies*, as **JSON backup**, **Markdown (.zip)**, **Obsidian vault (.zip)** or **HTML (.zip)**. Progress per chat, **Cancel** (a partial result of what was already read is still downloaded), per-chat failure list, the previous chat is reopened afterwards. Chats read from the page are also kept as *saved copies* in the extension archive.
- **Restore**: pick a JSON backup; strict validation and sanitization (hostile HTML, bad ids, oversized files, newer-version files are handled and reported); chats go to the archive, new folders and assignments are merged without overwriting anything you already have.
- **Saved copies**: count and size, two-click "delete all".
- **Obsidian export**: YAML front matter (title, id, url, dates, folder, tags), wikilink-safe and vault-unique file names, folders become directories. Also in the per-chat **Download** menu together with plain **Markdown**.
- **Merge chats into one document** (feature `merge-export`): choose chats, reorder, set a title, optional table of contents, export **PDF / Markdown / HTML**. PDF pipeline gained section headings and a contents list (single-chat PDFs unchanged).
- Host layer (`host/gemini.js`): `scrollableAncestor`, `sidebarScroller`, `chatScroller`, `openConversation`, `openNewChat`, `chatList` and the `newChat` / `chatScroller` selector lists. All page selectors stay in this file.
- `features/export/capture.js` (open a chat, scroll until lazy history stops growing, wait for it to settle, extract), `features/backup/{run,sources,summary,dialog,merge-dialog,index}.js`, `ui/chat-picker.js`, `core/jobs.js` (`waitUntil`, `createStabilityTracker`).
- ~85 i18n keys in en/ru/zh-CN/ar. 21 new jsdom-free tests (135 in total).

**Changed**
- `export/formats.js`: `downloadBlob`, `roleLabels`, `conversationToRecord`; `md` and `obsidian` formats.
- `scripts/build.mjs`: `charset: 'utf8'`. esbuild was escaping every non-Latin character as `\uXXXX`, which made the ru/ar/zh dictionaries about 3x larger. content.js is **253 KB** (it would have been 298 KB without this).

**Fixed (found while testing)**
- The HTML index of a bulk export put an unescaped file name into an `href`.

**Files touched**
`host/gemini.js`, `core/{config,jobs}.js`, `features/manifest.js`, `features/export/{formats,menu,controller}.js`, `features/export/pdf/{blocks,stage}.js`, `ui/icons.js`, `styles/theme.css`, `i18n/*.js`, `scripts/build.mjs`; new: `features/export/capture.js`, `features/export/serialize/{obsidian,bulk,merge}.js`, `features/backup/*`, `ui/chat-picker.js`, tests `bulk`, `sources`, extended `jobs`, `manifest-features`.

### Phase 1: shared platform (one visible addition: a Settings button)

**Added**
- `util/zip.js`: store-only ZIP writer (CRC-32, UTF-8 names, de-duplication, path-traversal-safe names, size/entry limits). Validated against Python's `zipfile`.
- `features/export/serialize/`: `markup.js` (tokenizer for the extractor's whitelisted HTML -> Markdown / plain text / **sanitized HTML**, code-block and table extraction), `record.js` (the stored/exported `ChatRecord`), `documents.js` (Markdown and standalone HTML documents), `backup.js` (re-importable JSON backup, strict parse, folder merge plan that never overwrites local data).
- `core/jobs.js`: cancellable sequential job runner (retries, per-item failures, `FatalJobError` to stop a batch, yields to the page between items).
- `background/archive.js` + `core/archive-client.js`: chat archive in the **service worker's IndexedDB** (extension origin, so Gemini's page scripts cannot read it; no `unlimitedStorage` needed). Message protocol `gemly:archive`, batching by count and size, re-sanitization in the worker, whitelisted operations.
- `ui/modal.js` (focus trap, Esc/backdrop, no leakage of keystrokes to Gemini shortcuts, survives SPA navigation), `ui/progress.js`, modal/switch/progress/notice styles in `theme.css` (light, dark and RTL).
- Settings: gear button in the bar, dialog with a **Features** section (one switch per feature, driven by the registry; applies after reload) and a section registry (`registerSettingsSection`, new `section` facet kind) that later phases plug into.
- 25 i18n keys in en/ru/zh-CN/ar (modal, settings, one title per feature).
- Tests: `zip`, `markup`, `serialize`, `jobs`, `archive`, `archive-client`, `i18n-parity` (jsdom-free twin of the existing parity test), `ui-pure`; manifest test extended (114 jsdom-free tests in total).

**Changed**
- `core/feature-registry.js`: facet kind `section`. `features/manifest.js`: `settings` row (locked). `theme.css`: `[hidden]` now wins inside Gemly UI descendants (a `display: flex` notice would otherwise never hide).
- `background/index.js`: serves the archive after the existing trusted-sender check. Bundle sizes: content.js 222.6 KB (was 206.0), content.css 29.3 KB, background.js 13.2 KB.

**Files touched**
`core/{config,feature-registry}.js`, `features/manifest.js`, `ui/icons.js`, `styles/theme.css`, `i18n/{en,ru,zh-CN,ar}.js`, `background/index.js`; new: `util/zip.js`, `core/{jobs,archive-client}.js`, `background/archive.js`, `ui/{modal,progress}.js`, `features/export/serialize/{markup,record,documents,backup}.js`, `features/settings/{index,registry,features-section}.js`, tests listed above.

### Phase 0: central feature registry and migration runner

Nothing user-visible changes. Every existing feature is routed through one registry so it can be switched on or
off from a single place, and storage gained a real migration mechanism that the next phases rely on.

**Added**
- `src/content/core/feature-registry.js`: feature ids, `enabled` kill switch, `locked`, `requires`, facet ownership
  (`widgets` / `actions` / `hooks`), resolution (manifest -> user override -> dependencies). Pure.
- `src/content/features/manifest.js`: the single table of all 19 features (13 App features + 6 sub-features that
  previously existed only as import side effects).
- `src/content/core/migrations.js`: stored schema version, ordered pure migrations, one-slot pre-migration backup.
- `Store` entry `features` (`gemly-features-v1`): per-user switches; `schemaVersion` and backup keys in `core/config.js`.
- `__gemly.diagnose()` now reports `inactive` and `featureFlags`.
- Tests: `features`, `migrations` (including Store wiring), `manifest-features`, `app-features` (66 jsdom-free tests
  in total with the existing ones).

**Changed**
- `main.js` now only starts `App` with `appFeatures()` from the manifest (feature order is unchanged and tested).
- `App`: rejects duplicate feature ids; resolves the switches after `Store.load()` and skips inactive features.
- `bar/registry.js`, `message-actions/registry.js`, `composer/send-hooks.js`: filter by feature ownership
  (memoised per registry version); `registerSendHook` now rejects duplicate ids like the other registries.
- `core/store.js`: runs migrations on load (never throws; failure leaves data untouched); test seam `_migrationOpts`.
- `ARCHITECTURE.md`, `PLAN.md` (new).

**Files touched**
`src/content/main.js`, `core/{app,config,diagnostics,schema,store}.js`, `features/bar/registry.js`,
`features/message-actions/registry.js`, `features/composer/send-hooks.js`; new: `core/feature-registry.js`,
`core/migrations.js`, `features/manifest.js`, `tests/unit/{features,migrations,manifest-features,app-features}.test.js`,
`PLAN.md`, `CHANGELOG.md`, `TESTING.md`.
