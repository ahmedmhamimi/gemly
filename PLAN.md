# PLAN

Status: **All phases (0-9) are done.** See OPEN-ITEMS.md for what could not be verified and for the decisions that are yours. Decisions in section 6 were taken as the stated defaults (keep the name, opt-in sync, delete as described, options page for Notion, slow bulk export accepted).

## 0. Environment and baseline

What I could and could not verify while working on this tree:

| Check | Result |
|---|---|
| `scripts/build.mjs` | Runs. `npm install` is impossible (no network), so I used the esbuild 0.27.7 that ships inside a global `tsx`. Output of the **unmodified** tree is byte-identical to the shipped `dist/`. The project pins `^0.28.2`; run a normal `npm install` locally. |
| Unit tests that need no jsdom (`text`, `tokens`, `pagination`, `schema`, `manifest`) | Run, 31/31 pass before my changes. |
| Unit tests that need jsdom (`app`, `store`, `i18n`, `misc`, `popover`) | **Cannot run here.** |
| ESLint, browser tests (puppeteer + Chromium) | **Cannot run here.** |

Consequence: every phase is built with the real bundler and covered by new jsdom-free tests, but you need to run `npm install && npm run check` locally before trusting a phase. I also mark any code path that only a real Gemini page can confirm.

## 1. How the existing code works

**Feature registration.** Three mechanisms, all wired by import side effects in `main.js`:

1. `App` takes an ordered list of `Feature` objects (`id`, `zones`, `init`, `scan`, `teardown`). The app owns one `MutationObserver`, a `Scheduler`, and fault isolation (5 consecutive failures disables a feature for the session).
2. Registries for sub-features: `registerBarWidget` (bar above the composer), `registerMessageAction` (per-reply buttons), `registerSendHook` (act on a prompt as it is sent). Modules call them at import time.
3. The `bus` (`core/events.js`) for decoupled notifications (`navigate`, `locale`, `store`, `activity`, `generating`, `user-sent`).

There was **no** central place to turn a feature off, and ids were not checked for uniqueness across the three mechanisms ("tone" is an app feature, a bar widget and a send hook at once).

**Storage and "schema versioning".** `core/store.js` loads every entry from `chrome.storage.local` once, sanitizes it with `core/schema.js`, serves deep-frozen snapshots, and writes in coalesced batches. "Versioning" is only the `-v1` suffix in key names. **There is no migration runner and no stored version number**; the brief's "add migrations through the existing schema versioning" therefore needs a small runner, which Phase 0 adds.

**UI kit.** Three layers: (a) `.gl-ui` DOM styled by `styles/theme.css` (tokens keyed on `data-gl-theme` / `data-gl-dir`), built from `Popover`, `Toast`, `LoadingPill`, `iconButton`, `icon()`; (b) a Shadow-DOM `UiKit` for the welcome/review surfaces; (c) `Lang.t()` for all strings (en, ru, zh-CN, ar, with a parity test). **There is no modal/dialog, tabs, checkbox list or progress-bar component yet.** Phases 1+ need them and will add them to `theme.css` using the same tokens.

**Host layer.** `host/gemini.js` holds every selector as an ordered fallback list and exposes `probe()` for `__gemly.diagnose()`.

## 2. Existing code I will reuse

| Existing | Reused by |
|---|---|
| `extractor.js` (`extractConversation`, `renderBlocks`: sanitized HTML from the live DOM) | all exports, search index, summarize, highlights |
| `formats.js` (`toJSON`, `toPlainText`, `downloadTextFile`) | extended with Markdown / HTML / Obsidian serializers |
| `pdf/export.js` + `blocks.js` (chunked, cancel-safe pipeline) | merged-document PDF (needs a "section heading" block kind) |
| `Store` + `schema.js` + `bus('store')` | every new persistent entry |
| `Scheduler` / `nextFrame` | job runner that yields between chats |
| `Popover`, `Toast`, `LoadingPill`, `flashButton` | menus, errors, short progress |
| `foldersModel` (`assignChat`, `flatten`) | bulk move, filters in search |
| `bookmarks` (message key = role + hash + predecessor hash) | message identity for highlights/notes (Feature 8) |
| `prompts` panel, `insertText`, `send-hooks` | templates, chains, personas, summarize |
| `context-meter` token estimate | trigger for "Summarize and continue" |

## 3. Phase 0: central feature registry and migration runner (DONE)

* `core/feature-registry.js`: pure mechanism (validates unique ids, `requires` graph, facet ownership; resolves default → user override → dependencies).
* `features/manifest.js`: **the single place**. One row per feature: `id`, `enabled`, optional `locked` (user override ignored), `requires`, the app `Feature` (if any) and the *facets* it owns (`widgets`, `actions`, `hooks`). Setting `enabled: false` on a row removes every facet of that feature without touching the feature's code.
* The three registries filter by ownership; `App` skips inactive features. Unclaimed facets fail **open** at runtime (with a one-time warning) and fail **closed** in the unit test, so a new feature cannot be forgotten.
* Optional per-user override in `Store` (`features` entry), applied on tab reload (hot-swapping `init()` listeners is not safe without the jsdom/browser suites).
* `core/migrations.js`: stored `gemly-schema-version`, ordered pure migrations, pre-migration backup, failure leaves data untouched.

## 4. Platform decisions for later phases

* **Where the big data lives.** A content script's `indexedDB` is the *page's* (gemini.google.com) database: Gemini's own scripts could read the chat index, and it would be wiped with the site's data. That contradicts the existing "chrome.storage, so Gemini can never read it" design. So the index and chat archive live in **IndexedDB inside the service worker** (extension origin), reached by trusted `runtime.sendMessage` calls. No `unlimitedStorage` permission is needed. `chrome.storage.local` stays for small data (folders, notes, prompts, profiles, settings).
* **Reading chats that are not open.** The only no-server way is Gemini's own page: click each sidebar chat, wait for turns to render, extract with the existing extractor, restore the original chat. It is slower than an API and visibly navigates the tab; it covers chats the sidebar has loaded (the job scrolls the list to load more). I will not call Gemini's private RPC endpoints.
* **New shared pieces** (Phase 1): modal/dialog + tabs + progress bar styles; a cancellable job runner (chunking + `scheduler`-style yields + per-item error collection); a store-only ZIP writer (CRC-32, ~100 lines) for multi-file downloads; pure serializers for JSON/Markdown/HTML/Obsidian; archive DB + message protocol; a Settings panel (feature switches, sync, Notion, summary prompt).
* **i18n.** Every new string goes to `en.js` and all three other locales (parity test). Non-English strings will be written by me and **need a native-speaker review** before release.

## 5. Phases

| # | Content | Features |
|---|---|---|
| 0 | Registry + migrations (done) | constraint 8 |
| 1 | Platform: modal, job runner, ZIP, serializers, archive DB (service worker), Settings panel (done) | shared |
| 2 | Backup/bulk export/restore; Obsidian + merge export (done) | 1, 2 |
| 3 | Cross-chat search index (done) | 3 |
| 4 | Bulk chat management (done) | 5 |
| 5 | Prompt templates, chains, import/export; personas (done) | 6, 9 |
| 6 | Code/table extraction (CSV; XLSX via store-only ZIP, validated with openpyxl); highlights + notes + Saved panel (done) | 7, 8 |
| 7 | Summarize and continue (done) | 4 |
| 8 | Light sync; Notion (optional host permission, options page, service-worker `fetch`) (done) | 11, 10 |
| 9 | Polish, size budget, version bump (1.1.0), CHANGELOG, TESTING, PRIVACY, OPEN-ITEMS (done) | all |

## 6. Conflicts with the brief and decisions I need from you

1. **Extension name contains "Gemini".** `__MSG_extName__` is "Gemly for Gemini: Search, Folders & Export" and the README title is "Gemly for Gemini". Constraint 7 allows the word only to describe compatibility. "for Gemini" is a common pattern but the Chrome Web Store can still reject it as a trademark use. I have **not** changed it. Options: keep, or rename to e.g. "Gemly: Search, Folders & Export" (description can still say "for gemini.google.com").
2. **Feature 11 vs constraint 6.** `chrome.storage.sync` uploads data through Chrome Sync to the user's Google account, so "nothing is sent anywhere" is no longer literally true for that data. I plan to make it **opt-in, off by default**, with an in-product disclosure, and to list it in your privacy policy. Please confirm.
3. **Bulk delete (Feature 5) drives Gemini's own menu and confirm dialog.** The selectors cannot be verified offline. I will use ordered fallbacks plus multi-language text matching, stop the batch on the first unrecognised dialog, and report per-item failures. A live smoke test is essential before shipping.
4. **Notion (Feature 10) looks feasible**: CORS forces the request into the service worker, and `permissions.request` needs a user gesture, so the opt-in button must live on a new extension **options page** (no new permission; it adds `options_ui` and `optional_host_permissions: https://api.notion.com/*`). Please confirm you accept an options page.
5. **Bulk export takes real time** (a few seconds per chat, tab navigates). Acceptable?

If you answer "go with defaults": 1 keep the name, 2 opt-in sync, 3 as described, 4 yes, 5 yes: I continue with Phase 1.
