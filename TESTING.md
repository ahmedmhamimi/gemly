# Testing

## Automated

```
npm install
npm run check          # lint + unit (jsdom) + real-browser tests
npm test               # unit tests only
```

Tests that need no jsdom or browser (they run anywhere with Node >= 20):

```
node --test tests/unit/text.test.js tests/unit/tokens.test.js tests/unit/pagination.test.js \
  tests/unit/schema.test.js tests/unit/manifest.test.js tests/unit/features.test.js \
  tests/unit/migrations.test.js tests/unit/manifest-features.test.js tests/unit/app-features.test.js \
  tests/unit/zip.test.js tests/unit/markup.test.js tests/unit/serialize.test.js tests/unit/jobs.test.js \
  tests/unit/archive.test.js tests/unit/archive-client.test.js tests/unit/i18n-parity.test.js tests/unit/ui-pure.test.js \
  tests/unit/bulk.test.js tests/unit/sources.test.js tests/unit/tokenize.test.js tests/unit/archive-search-pure.test.js \
  tests/unit/archive-search-ui.test.js tests/unit/search-index.test.js \
  tests/unit/bulk-ops.test.js tests/unit/delete-job.test.js tests/unit/selection.test.js \
  tests/unit/template.test.js tests/unit/chain.test.js tests/unit/prompt-transfer.test.js tests/unit/personas.test.js \
  tests/unit/extract.test.js tests/unit/saved.test.js tests/unit/summarize.test.js \
  tests/unit/i18n-usage.test.js
# or simply every test file that does not import env.js (jsdom):
node --test $(grep -L env.js tests/unit/*.test.js)
```

The whole 1.1.0 build was verified with exactly this set (290/290 passing) plus a production build. `npm run lint`, the jsdom unit
tests and the browser tests could not be run in the authoring environment (no network, so no `npm install`):
**run `npm run check` before relying on a phase.**

## Manual checklist

### Phase 0: feature switches and migrations
Load `dist/` unpacked, open gemini.google.com, open DevTools and select the extension's context in the console.

- [ ] Everything works as before: bar above the prompt (tone, library, counters, copy, download), per-reply buttons,
      sidebar search + folders, bookmarks dock, in-chat search (Ctrl/Cmd+Shift+F), double-click rename/edit.
- [ ] `__gemly.diagnose().featureFlags` lists 19 features, all `enabled: true`; `inactive` is `[]`.
- [ ] `chrome.storage.local.set({'gemly-features-v1': {tone: false}})`, reload: the tone chip is gone, no tone tag is
      ever added to a prompt, the rest is unchanged; `diagnose().inactive` shows `tone`.
- [ ] Same with `{bar: false}`: the whole bar disappears and `tone` is reported as `requires "bar"`.
- [ ] `{export: false}`: the bar download button **and** the per-reply download button are gone; copy buttons stay.
- [ ] `{shell: false}` has no effect (locked row).
- [ ] `chrome.storage.local.remove('gemly-features-v1')`, reload: back to normal.
- [ ] Existing data survives an upgrade: folders, bookmarks, prompts and the selected tone are still there after loading
      this build over a profile that used 1.0.0.

### Phase 1: platform and Settings
- [ ] A gear button appears at the right end of the bar; clicking it opens a "Settings" dialog with a "Features" list.
- [ ] Dialog: Esc closes it; clicking the dark backdrop closes it; Tab/Shift+Tab stay inside; focus returns to the gear.
- [ ] Typing in the dialog never triggers a Gemini shortcut.
- [ ] Switch "Tone picker" off: a "Reload the page to apply your changes." notice with a Reload button appears. Switch it back on: the notice disappears. Switch it off, reload: the tone chip is gone.
- [ ] "Settings", "Tooltips and notices" and "Prompt send handling" show "Always on" and cannot be switched.
- [ ] Switch "Toolbar above the prompt box" off, then look at "Tone picker": it shows "Needs “Toolbar above the prompt box”" while staying checked.
- [ ] Dark theme and an RTL language (Arabic): the dialog, switches (knob direction) and notice look right.
- [ ] The chat archive's IndexedDB adapter (`IdbBackend` in `background/archive.js`) is **only code-reviewed so far**: its logic is tested through an in-memory backend, but no real browser has run it. The Phase 2 backup UI is its first real exercise; until then it can be checked in the service-worker DevTools (`chrome://extensions` > Gemly > service worker) under Application > IndexedDB > `gemly-archive`.

### Phase 2: Obsidian download
> Backup, bulk export, restore and merge were removed: skip every item below that mentions them (and "Saved copies" / "Backup" elsewhere).
Everything here drives the real Gemini page and a real IndexedDB, so it is **not covered by automated tests**. Run these on a profile with at least ~5 chats, one of them long (50+ messages), one inside a folder.

Bulk export
- [ ] Bar > archive button opens "Backup & export". Scope "All chats in the sidebar" + JSON: the chat list loads (counter grows), then chats open one by one, the progress bar and the current title update, a file `gemly-backup-YYYY-MM-DD.json` downloads, and you land on the chat you started from.
- [ ] A long chat is exported **completely** (open the JSON: first message is the real first message, not the oldest one that was loaded).
- [ ] Cancel mid-way: the dialog says how many chats were read and downloads those; the original chat is reopened.
- [ ] While running: the dark backdrop blocks clicks, Esc/backdrop do not close the dialog; after it finishes they do.
- [ ] Scope "A folder" (with a subfolder), "Chats I select…" (search, select all, none, 300+ chats shows the "refine the search" note), "Saved copies" (does **not** navigate the page).
- [ ] Formats: Markdown zip (one `.md` per chat, duplicate titles get `(2)`), Obsidian zip (folders become directories; open in Obsidian: front matter parsed, `[[links]]` safe, tags `#gemly`), HTML zip (open `index.html` offline, light/dark follow the OS).
- [ ] A chat that cannot be read (delete one in another tab mid-run) is listed under "Could not read" and does not stop the rest.
- [ ] Hidden/background tab: still finishes, just slower. A Gemini layout change that breaks `chatScroller` / `newChat` shows up in `__gemly.diagnose()`; the export still works for short chats.

Restore
- [ ] Restore the JSON from above: "N chats found", Restore, toast; "Saved copies" count grows. Restore the same file again: nothing duplicates.
- [ ] Folders from the backup appear if missing; an existing folder with the same id is untouched; a chat already in one of your folders is not moved.
- [ ] Wrong file (a `.json` that is not a backup, an empty file, a hand-edited file with `<script>` in a message, a 400 MB file) gives a clear message and changes nothing.
- [ ] "Delete all saved copies": first click arms the button, second deletes; Gemini chats are untouched.

Per-chat download menu and merge
- [ ] Download menu now has Markdown and Obsidian; the Obsidian file starts with `---` front matter.
- [ ] "Merge chats into one document…": pick 3, reorder with the arrows, title, TOC on/off; PDF (section headings + contents list), Markdown (anchors in the contents jump to the right heading in Obsidian), HTML (TOC links work). Choosing 1 chat keeps "Create document" disabled.
- [ ] RTL (Arabic UI) and dark mode for all three dialogs.
- [ ] Settings > Features: switch "Merge chats into one document" off and reload: the merge button is gone; switch "Backup, bulk export & restore" off: the bar button is gone and merge is reported as needing it.
- [ ] First real run of the archive's IndexedDB adapter: DevTools of the service worker > Application > IndexedDB > `gemly-archive` > `chats` has one row per exported chat.

### Phase 3: cross-chat search
Needs a real browser. Start with a profile that already used Phase 2 (so the archive has data in the old v1 layout).

- [ ] **Upgrade path**: load this build over a profile that has saved copies from Phase 2. Open Settings > Search index: it says "Index incomplete: 0 of N chats are searchable". Click **Rebuild index**: progress runs, ends with "Index rebuilt.", the line now says N chats are searchable. (DevTools of the service worker > Application > IndexedDB > `gemly-archive` now has `postings` and `terms`.)
- [ ] Search button (bar) and **Alt+Shift+F** open the dialog with the cursor in the box; Esc closes it.
- [ ] Type a word you know is in an old chat: results appear within a fraction of a second, the matching words are highlighted in the snippet and the title, the date and message count show. Typing more narrows; a stale answer never overwrites a newer one.
- [ ] Multi-word query is AND (both words in the same chat, possibly different messages). The **last** word also matches as a prefix ("hoo" finds "hooks").
- [ ] Accents: "cafe" finds "café"; Arabic without diacritics finds the vowelled word; Chinese: searching 学习 finds 机器学习.
- [ ] Filters: *Saved from/to* excludes chats outside the range; *Folder* limits to that folder and its subfolders; an empty folder returns nothing.
- [ ] Click a result: a chat that is in the sidebar opens without a page reload; a chat that is not loaded opens by its saved path (full load). A restored-from-backup chat with no path says "can't be opened from here".
- [ ] **Automatic saving**: open a chat you have never exported, wait ~5 s, search for a word from it: it is found. Send a message, wait for the reply, search for a word from the reply: found. Open DevTools > Performance during typing: no periodic work while idle.
- [ ] **Long chat**: open a chat with 100+ messages **without** scrolling up. After it is auto-saved, search for something only in its *early* messages (saved earlier by Backup & export): still found (the partial view did not overwrite the full copy).
- [ ] Settings > Features: switch off "Automatic saving of opened chats", reload: opening a new chat no longer adds it (check Backup > Saved copies count). Switch off "Search across all saved chats": the bar button, shortcut and the Settings > Search index section disappear.
- [ ] Rebuild with Cancel: after cancelling, search is partial and the Settings line says the index is incomplete; rebuild again to fix.
- [ ] Backup > "Delete all saved copies": search finds nothing afterwards, index stats are 0.
- [ ] Dark mode and Arabic (RTL): highlights, filter row and result cards look right.
- [ ] The 1,000-chat case: restore a large backup (or export all with many chats), rebuild; the page stays responsive during the rebuild (all heavy work is in the service worker).

### Phase 4: bulk chat management
**Use a throwaway Google account or chats you do not mind losing for the delete tests. They drive Gemini's real delete flow.**
- [ ] Sidebar shows a "Select chats" button under the filter box. Click it: checkboxes appear on rows, a bar shows "0 selected" with 5 icon buttons and a close button. Esc and the X leave the mode and clear the selection.
- [ ] Clicking a row selects it and does **not** open the chat; Space/Enter on a focused checkbox toggles; **Shift-click** selects/deselects a range; "select all visible" respects the sidebar text filter.
- [ ] **Move to folder**: pick a folder, Move: the chats appear in that folder (Folders section). "New folder…" creates and moves. "No folder" removes them from folders.
- [ ] **Tags**: add `work, ideas`; the chips show; × removes a tag from the selected chats; clicking a tag in "Show chats with a tag" fills the sidebar filter and filters by it; typing a tag in the sidebar filter finds tagged chats.
- [ ] **Archive**: chats disappear from the sidebar, toast with Undo restores them; "Archived (n)" lists them, Unarchive works, "Show archived chats" shows them again. The chats still exist in your Google account (open one from the search dialog).
- [ ] **Delete, happy path** (3 throwaway chats): confirm dialog lists them; the red button stays disabled until "I understand" is ticked; progress shows each title; each chat disappears from the sidebar; summary "Deleted 3 chats". Folders/tags/archive entries of those chats are gone. With "also delete saved copies" ticked, Backup > Saved copies drops accordingly.
- [ ] **Cancel** mid-way: stops before the next chat, no menu/dialog is left open, the summary says how many were deleted.
- [ ] **Failure per chat**: select a chat and delete it in another tab first: it is reported as "not loaded in the sidebar" (or similar) and the others still delete.
- [ ] **Layout-change safety**: in DevTools temporarily rename the confirm button text or remove the row menu button node and run a delete: the batch **stops at the first chat**, says which step failed, closes the open menu/dialog, and nothing else is deleted.
- [ ] Switch "Bulk delete" off in Settings > Features, reload: the trash button is gone, everything else still works.
- [ ] Dark mode, RTL (checkbox on the correct side, sticky bar), narrow sidebar (block hides at the collapsed rail like the filter box).
- [ ] Folders still work as before (drag/drop, row "…" menu "Move to folder") — Phase 4 reuses their menu-button lookup, so check this explicitly.

### Static check (run after every change; needs `typescript` installed globally or as a dev dependency)
`npx tsc --allowJs --checkJs --noEmit` with `lib: [es2023, dom]` and a `declare const chrome: any;` shim; look only at codes 1117, 2300, 2304, 2305, 2307, 2614, 2552, 2448. (ESLint's `no-undef` in `npm run lint` covers the same ground.)

### Phase 5: templates, chains, import/export, personas
- [ ] Prompt library: add a prompt `Explain {{topic}} to a {{level:beginner|expert}} in {{words=100}} words`. The row shows a `{ } 3` badge. Click it: a form with a text box, a dropdown (beginner selected) and a box with 100; the preview updates as you type; Insert puts the rendered text in the prompt box **where the caret was**. Typing in the form never triggers Gemini shortcuts.
- [ ] `{{date}}` in a prompt inserts today's date in the UI language without asking. `\{{x}}` inserts a literal `{{x}}`. A prompt with no variables inserts immediately like before.
- [ ] **Chain**: add a prompt with two extra steps ("+ Step 2", "+ Step 3"). The row shows a ▶ 3 badge. Run it in a **new empty chat**: a preview of the steps, then a floating "Step 1 of 3…" bar with Stop. Each step is sent only after the previous reply has finished (watch a long reply). Tone presets (if one is selected) are applied to each step.
- [ ] Stop during a long reply: the chain ends, the toast says how many steps ran; nothing more is sent.
- [ ] Start a chain with text already in the prompt box: refused with "Clear the prompt box first".
- [ ] While a chain waits for a reply, open a **different** chat from the sidebar: the next step is NOT sent; toast "you opened a different chat".
- [ ] Switch "Prompt chains" off in Settings > Features, reload: a chain prompt inserts only its first step; the "+ Step" button is gone from the form.
- [ ] Export (footer, download icon) then delete a prompt then Import the file: it comes back; importing the same file again says everything was skipped as duplicates. A wrong file / empty file / hand-edited file with `<script>` in a prompt gives a clear toast or is cleaned.
- [ ] **Personas**: create two. Click one while in an existing chat: a new chat opens and the instruction is in the prompt box (not sent) with a toast; with "Send right away" ticked it is sent. The "+" button adds the persona to the current chat instead. The last applied one shows a check and the button tooltip names it. Alt+Shift+P opens the popover. Deleting the active persona clears the mark.
- [ ] Export now also contains personas; importing into a fresh profile restores them.
- [ ] Dark mode, RTL, narrow window: the form, preview and chain bar look right and the chain bar does not cover the prompt box.

### Phase 6: code & table extraction
- [ ] Ask for a reply with two code blocks (Python + a Dockerfile or shell) and a table. A `</>` button appears in that reply's action row (and NOT on replies without code/tables, or while the reply is streaming).
- [ ] Menu: "Copy all code (2)" puts both blocks in the clipboard; "Download code as files (2)" gives one ZIP with correct extensions (`.py`, `Dockerfile`/`.sh`); a reply with ONE block downloads the file directly.
- [ ] "Download tables as CSV": opens correctly in Excel/LibreOffice with accents, Arabic or Chinese intact; a cell starting with `=` or `@` arrives as text (prefixed with an apostrophe) and numbers like `-5` stay numbers.
- [ ] "Download tables as Excel": opens without a repair prompt in **Excel and LibreOffice** (important: only openpyxl has read it so far); header bold, numbers numeric, `007` stays `007`, several tables become several sheets.
- [ ] The button disappears/appears correctly when a reply is regenerated with different content.

### Phase 6: highlights and notes
- [ ] Select a phrase inside a **reply**: a small bar with "Highlight" / "Highlight + note" appears above it; selecting inside the prompt box or the extension's own UI shows nothing. Esc, scrolling or clearing the selection hides it.
- [ ] Highlight: the text turns yellow without any visible change to the message layout. Reload the page and reopen the chat: the highlight is back. Highlight the 2nd occurrence of a repeated word: the 2nd one is painted, not the 1st.
- [ ] A highlight whose message is not loaded (long chat, scrolled) is simply not painted, and appears when the message loads.
- [ ] "Highlight + note": the note dialog opens; Ctrl/Cmd+Enter saves; Remove deletes the highlight.
- [ ] Bar star button opens "Saved": "This chat" and "All chats" tabs; search finds quotes and notes; "Note"/"Edit note" works inline; "Go to" scrolls to and flashes the message (for another chat it opens that chat); Remove works for both highlights and starred messages (the star on the message updates).
- [ ] Export a chat that has a star with a note and a highlight with a note to **PDF, Markdown, Obsidian, HTML, JSON, TXT**: each has a "Saved" section with both. Bulk export / backup JSON include them too. Searching for a word that only appears in a note finds the chat.
- [ ] Dark mode: the highlight colour is readable; RTL: panel and toolbar look right.

### Phase 7: summarize and continue
**This sends a real message into a real chat; use a test chat.**
- [ ] Bar button (compress icon) opens a dialog explaining the flow, with the editable summary request and intro. Edit the request, Start: the edited text is what gets typed and sent. Reopen the dialog: your edit is remembered; "Reset to default" restores the default (and it follows the UI language again).
- [ ] During the flow a floating status bar with Stop shows. The request appears in the chat and is sent; the status changes only after the **whole** reply has finished (use a long reply).
- [ ] Afterwards a **new chat** opens with intro + summary in the prompt box, **not sent**; the toast tells you to add your message.
- [ ] Stop during the wait: nothing further happens, the toast says Cancelled; the summary stays in the old chat.
- [ ] Open a different chat during the wait: the flow stops ("you opened a different chat") and does not open a new chat.
- [ ] With text already in the prompt box: refused with a clear message and nothing is sent.
- [ ] Threshold: in Settings > "Summarize and continue" set 30%; in a chat above that the button pulses and a toast with a "Summarize" action appears once per chat (not again until the page is reloaded). Reduced-motion disables the pulse.
- [ ] Simulate a failed SPA navigation (e.g. block the New chat control in DevTools): the page reloads to the start page and the summary appears in the prompt box (within 2 minutes), once.

### Final regression pass (after everything above)
- [ ] Fresh profile: install, open Gemini: bar shows the new buttons, nothing throws in the console, `__gemly.diagnose()` lists every feature enabled and every selector with a match count.
- [ ] Upgrade profile (1.0.0 data): folders, bookmarks, prompts, the selected tone and the in-chat search all still work; storage schema version stamped.
- [ ] Original features unchanged: character counter, context meter, copy conversation, PDF / JSON / text download, tone presets, quick actions (double-click rename/edit), sidebar filter and folders (drag and drop, row menu).
- [ ] Each of the 33 features switched off one at a time in Settings > Features (reload each time): the page stays healthy and only that feature disappears.
- [ ] Light and dark theme, all four languages (RTL for Arabic), a narrow window, a very long chat (1000+ messages) with the DevTools Performance panel open while idle: no periodic work.
- [ ] `npm run check` passes (lint, jsdom unit tests, browser tests).

### Static check used during development
Run `tsc --allowJs --checkJs --noEmit` with `lib: [es2023, dom]`, `noUnusedLocals: true` and a `declare const chrome: any;` shim, and look only at codes 1117, 2300, 2304, 2305, 2307, 2614, 2552, 2448, 6133, 6192. It caught three real bugs during development that no other tool here could.
