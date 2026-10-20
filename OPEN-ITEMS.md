# Open items and decisions

## Could not be verified (needs a real browser; none of it could run in the authoring sandbox)
The sandbox had no network, so `npm install` was impossible. The build used esbuild 0.27.7 (you pin `^0.28.2`);
**ESLint, the jsdom unit tests and the real-browser tests have not been run**. What *was* run: 290 jsdom-free
unit tests, a production build, a TypeScript `checkJs` pass for undefined names / duplicate keys / bad imports /
unused symbols, and an openpyxl load of the generated .xlsx. Run `npm install && npm run check`, then walk
TESTING.md. In order of risk:

1. **Gemini's DOM.** All selectors are in `host/gemini.js`; new ones (best guesses, with fallbacks): the chat and
   sidebar scrollers, the New chat control, the row "..." menu / Delete / confirm dialog, the prompt box and Send
   button used by chains, summarize and personas. A change shows in `__gemly.diagnose()`.
2. **Bulk delete** drives Gemini's real delete flow. It stops the whole batch on the first thing it does not
   recognise. Test on a throwaway account first (TESTING.md, Phase 4).
3. **IndexedDB adapter** (`background/archive.js`, `IdbBackend`): its logic is tested through an in-memory
   backend; the browser adapter was only reviewed. Includes the v1 -> v2 upgrade for Phase-2 archives.
4. **Everything visual**: the dialogs, dark mode, RTL, highlight painting (CSS Custom Highlight API).
5. **Excel compatibility** of the .xlsx: valid per openpyxl; open it once in Excel itself.
6. **Chains / summarize** depend on detecting "the reply has finished" (generation indicator idle for 3 polls).

## Decisions for you
1. **Extension name.** `__MSG_extName__` is "Gemly for Gemini: Search, Folders & Export". Your brief allows the word
   "Gemini" only to describe compatibility; the Chrome Web Store can still reject "for Gemini" as a trademark use.
   Left unchanged. Suggest "Gemly: Search, Folders & Export" and describing compatibility in the description.
2. **Bundle size.** content.js is 406 KB (it was 200 KB); 136 KB of it is the four translation dictionaries.
   Loading only the active language would save ~100 KB for most users, but it changes the synchronous `Lang.t`
   contract and needs web-accessible dynamic imports; not done without a browser to verify it. Say if you want it.
3. **Automatic saving of opened chats is ON by default** (needed for "chats the extension has seen" in search).
   It is local, visible in Settings, and disclosed in PRIVACY.md. Say if you prefer it off by default.
4. **Privacy disclosure.** The extension no longer has any network feature (sync and Notion were removed). PRIVACY.md says so.
6. **Translations** (ru, zh-CN, ar) for the 368 new strings were written by the assistant and need a native-speaker review.

## Not built (out of scope per the brief) and known limits
- No cloud sync of chats, shared libraries, dashboards, Google Docs export, outside AI calls, licensing or accounts.
- Search "dates" mean "last saved" (Gemini does not expose a chat's date in the page).
