# Gemly

A productivity layer for gemini.google.com: folders, search across all your chats, prompt templates and chains, personas, highlights and notes, summarize-and-continue,
and more. Works on gemini.google.com only (the name describes compatibility; this is an
independent extension).

## Features
- **Organise**: folders, bookmarks, bulk select (move, tag, archive, delete), highlights with notes, a Saved panel.
- **Find**: in-chat search, sidebar filter (titles and tags), **search across every saved chat** (date and folder filters).
- **Export**: PDF, Markdown, Obsidian, HTML, JSON, text; code blocks as files; tables as CSV / Excel.
- **Write**: prompt library with `{{variables}}`, dropdowns and **multi-step chains**; tone presets; personas; character counter and context meter; **summarize and continue in a new chat**.
- Every feature can be switched off from **Settings > Features** (and, for developers, from one table: `src/content/features/manifest.js`).

## Use it
1. `npm install && npm run build` (or use the prebuilt `dist/` folder in this archive).
2. Chrome -> `chrome://extensions` -> enable **Developer mode** -> **Load unpacked** -> choose `dist/`.

## Develop
```
npm run watch          rebuild on change (dev build with source maps)
npm run check          lint + unit + real-browser tests
```
See **ARCHITECTURE.md** (how it is organised, how to add a feature, how to fix a broken selector),
**TESTING.md** (automated and manual checklists), **CHANGELOG.md**, and **OPEN-ITEMS.md**.

## Privacy
Your data stays on your device. There is no server, no analytics, no account, and no
remote code. Everything is kept in `chrome.storage.local` and in the extension's own
IndexedDB (saved chats and the search index live in the extension's storage, not in the
page's, so the site cannot read them). Nothing is ever sent anywhere; see **PRIVACY.md**.

Permissions: `storage`, `scripting` (loads the PDF engine on demand) and access to
`gemini.google.com`. Nothing else, not even optional permissions.

## Not wired yet (on purpose)
No feedback/support links. The review prompt is dormant until `CONFIG.store.reviewsUrl`
(`src/content/core/config.js`) is set.
