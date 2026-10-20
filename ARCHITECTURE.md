# Gemly - architecture

Gemly is a Manifest V3 extension: one content script on `gemini.google.com`
plus a small service worker. Source is ES modules, bundled by esbuild into
`dist/` (`npm run build`). No runtime dependencies; the PDF engines
(html2canvas, jsPDF) ship as static files and are injected **on demand**.

```
src/
  background/index.js        service worker: install flow, welcome claim, PDF-engine injection, archive messages
  background/archive.js      chat archive in the worker's IndexedDB (extension origin, not the page's)
  content/
    main.js                  entry: starts the App with features/manifest.js
    core/                    framework (knows nothing about any one feature)
      app.js                 feature host + mutation pipeline + lifecycle
      feature-registry.js    feature ids, on/off resolution, facet ownership (pure)
      migrations.js          stored schema version + ordered data migrations (pure)
      jobs.js                cancellable sequential job runner (bulk export/delete, chains)
      archive-client.js      content-side client of the chat archive (batched messages)
      scheduler.js           coalescing scan scheduler
      message-index.js       per-turn cache (tokens, hash) invalidated by mutations
      store.js, schema.js    persistent data: sanitized, frozen snapshots, batched writes
      events.js              tiny event bus (features never import each other to announce things)
      lifecycle.js           dead-context detection, instance eviction, cleanup
      diagnostics.js         health warnings + __gemly.diagnose()
      config.js, log.js, theme.js
    host/gemini.js           THE ONLY FILE THAT KNOWS GEMINI'S DOM
    features/manifest.js     THE single place that lists every feature and whether it is on
    features/<name>/         one folder per feature
    ui/                      shared UI: popover manager, tooltip, toast, icons, flash button
    util/                    pure helpers (text, tokens, plaintext, clipboard, editor, dom)
    i18n/                    en, ar, ru, zh-CN
    styles/theme.css         the whole design system (tokens + components)
```

## Data flow

```
 DOM mutation ──► App._classify: which ZONE? which TURN? ──► MessageIndex.invalidate(turn)
                                   │
                                   └─► Scheduler.mark(zone) ─► (rate-limited, leading edge, paused when tab hidden)
                                                                     │
                       ScanContext { zones, generating, turns, links }   ▼
                                   each Feature whose zones are dirty:  scan(scanCtx, appCtx)
```

* **Zones** (`sidebar | composer | chat | global`) come from `host.zoneOf(node)`.
  Mutations outside every known region (tooltips, overlays) are ignored; a mutation
  that *contains* a region (route swap) is `global` and re-runs everything.
* **Idempotent scans.** `feature.scan()` reconciles: "if my UI is missing, build it;
  otherwise update only what changed". Gemini re-renders freely, so this is what
  keeps Gemly alive across SPA navigation.
* **Own-mutation filter.** Everything Gemly injects carries `.gl-ui`
  (or `data-gemly-owned`); `isOwnMutation()` drops those records so Gemly can never
  trigger itself.
* **Fault isolation.** A throwing feature is counted; after 5 consecutive failures it
  is torn down and disabled for the session while the rest keep running.

## The Feature contract (`core/app.js`)

```js
export const myFeature = {
  id: 'my-feature',
  zones: ['chat'],                 // which dirty zones trigger scan()
  init(ctx)  { /* once: ctx.listen(...), ctx.onDispose(...) */ },
  scan(scan, ctx) { /* idempotent reconcile */ },
  teardown() { /* remove injected UI/state */ },
};
```

`ctx.listen` / `ctx.onDispose` register cleanup that runs on shutdown, so nothing leaks
when the extension is reloaded.

## Extension points (add a feature without touching existing ones)

| You want to…                              | Do this |
|-------------------------------------------|---------|
| Add a control to the bar above the prompt | `registerBarWidget({ id, order, build, update })` (`features/bar/registry.js`) |
| Add a button to each reply's action row   | `registerMessageAction({ id, order, build, update })` |
| Act on a prompt as it is sent             | `registerSendHook({ id, prepare })` (`features/composer/send-hooks.js`) |
| Show a menu / panel                       | `Popover.open({ anchor, content })` - positioning, dismissal, a11y are handled |
| Persist data                              | add a sanitizer in `core/schema.js`, an entry in `DEFS` in `core/store.js`, then `Store.get/update` |
| React to something elsewhere              | `bus.on('navigate' \| 'locale' \| 'theme' \| 'store' \| 'generating' \| 'activity' …)` |
| Add a language                            | new `i18n/xx.js` with the same keys (a test enforces parity) |

Then import the feature in `features/manifest.js` and add **one row** for it (see below).

## Feature switches (one place)

Every feature has a unique kebab-case id and one row in `features/manifest.js`:

```js
{ id: 'tone', app: toneFeature, widgets: ['tone'], hooks: ['tone'], requires: ['bar', 'send-hooks'] },
```

A row owns the **facets** of a feature: its `app` Feature, bar `widgets`, message `actions` and send
`hooks`. Setting `enabled: false` on the row switches all of them off without touching the feature's
code. The registries (`bar/registry.js`, `message-actions/registry.js`, `composer/send-hooks.js`) and
`App` consult `core/feature-registry.js`; nothing else needs to know.

Resolution, in order: the row's `enabled` (a developer kill switch that users cannot override) -> the
user's override in the Store (`features` entry, `{ id: false }`; can only switch a feature **off**;
ignored for `locked` rows) -> `requires` (a feature whose requirement is off is off too). Changes apply
on the next page load. Quick manual switch from the extension's DevTools context:

```js
chrome.storage.local.set({ 'gemly-features-v1': { tone: false } })   // then reload the tab
chrome.storage.local.remove('gemly-features-v1')                       // back to defaults
__gemly.diagnose().featureFlags                                        // what is on, and why not
```

A widget/action/hook that no row claims still runs (fail open) but logs one warning, and
`tests/unit/manifest-features.test.js` fails, so a feature cannot be forgotten.

## Settings sections, modal, jobs

`registerSettingsSection({ id, order, title, build })` (features/settings/registry.js) adds a section to the Settings
dialog; the owning feature lists it as `sections: [id]` in the manifest. `Modal.open()` (ui/modal.js) is the one blocking
panel (focus trap, Esc, survives SPA navigation, use `setDismissible(false)` while a job runs). Anything that walks a list
of chats uses `runJob()` (core/jobs.js) so it is cancellable, yields to the page and collects per-item failures.

## Where big data lives

Small data (folders, notes, prompts, settings) stays in `chrome.storage.local` through the Store. Chat bodies and the search
index live in **IndexedDB inside the service worker**, because a content script's `indexedDB` is the page's own and
Gemini's scripts could read it. The content script talks to it through `core/archive-client.js`; the worker re-sanitizes
everything it stores (`features/export/serialize/record.js`).

## Search index

`background/search-index.js` keeps an inverted index next to the archive (same IndexedDB, `postings` + `terms`). The tokenizer
(`features/archive-search/tokenize.js`) is shared with the page-side highlighter so a hit in the index is always findable in
the text. Chats get into the archive by automatic saving of opened chats
(`putSeen`, aligns a possibly partial view to the stored copy). Queries run in the worker; the page only renders results.

## Network

None. The extension has no sync and no cloud export; the service worker only serves the archive, injects the PDF
engines on demand and handles the one-time welcome.

## Storage migrations

`core/migrations.js` keeps a stored integer (`gemly-schema-version`; absent = 1) and an append-only list of
pure steps `{ to, name, up(data) }`. `Store.load()` runs the pending steps on the raw stored values, then writes
the changed keys, the new version and a one-slot backup (`gemly-premigration-backup`) in **one** storage call.
A throwing step leaves stored data untouched (the sanitizers still read it). Steps must be idempotent. Data
written by a newer build is never modified. Prefer additive fields with a sanitizer default; add a step only
when data has to be moved or rewritten. `SCHEMA_VERSION` must equal the last step's `to` (a test enforces it).

## When Gemini changes its markup

Only `src/content/host/gemini.js` should need editing. Every selector is an *ordered
fallback list*; add a new fallback at the front. To find what broke, open DevTools on
Gemini, pick the extension's context in the console's context dropdown and run:

```js
__gemly.diagnose()   // match counts per selector, per-feature status, feature switches, scan count
```

The app also logs a one-time warning (`[Gemly][health]`) naming the selector to fix when
it cannot find the prompt box, chat turns or sidebar links. For verbose tracing:
`chrome.storage.local.set({'gemly-debug': true})` and reload the tab.

## Performance model

* One page-wide `MutationObserver` (child/text only); cheap classification, a stride
  sampler for huge batches, and a second *attribute-only* observer on the small
  composer subtree to see the send/stop button flip.
* Scans are **rate-limited, not debounced** (a debounce starves while Gemini streams):
  120 ms idle, 450 ms while generating, never while the tab is hidden.
* `MessageIndex` computes each message's tokens/hash once and only again after a mutation
  inside that turn - the context meter is O(changed turns), not O(chat).
* `Store.get()` returns shared frozen snapshots (no cloning on hot paths); writes are
  coalesced into one `chrome.storage` call per burst and flushed on tab hide.
* Sidebar rows use event delegation + a `WeakSet`; no per-scan listener churn.
* Tooltip timers/observers exist only while a tooltip is visible; nothing polls at idle.
* PDF engines (~700 KB) load on first export, not on every page. Rendering happens in a
  hidden iframe so html2canvas clones a tiny document instead of the whole Gemini page,
  in bounded chunks (see below).

## PDF pipeline

`buildBlocks` splits the conversation into small blocks (one per paragraph/list/table/
code block; huge code blocks and tables are split into parts) -> `measure` (one layout
pass) -> `groupIntoChunks` (each raster pass < `maxChunkCssPx`) -> per chunk:
html2canvas at a scale that keeps the canvas under the browser limit -> `planPlacements`
paginates each block (slicing only blocks taller than a page) -> canvas released before the
next chunk. Chat length is therefore unlimited; memory stays flat.

## Edge cases that are handled on purpose

Extension reload/update mid-session (orphaned instance evicts itself; new instance
sweeps leftovers) - corrupt/old/hostile stored data (sanitizers: cycles, depth, types,
CSS/HTML injection, protocol-relative paths) - storage quota/IO errors (toast, in-memory
state stays usable) - Enter while Gemini is generating (never clicks "stop") - Enter on an
empty/disabled prompt, key-repeat, IME composition - tone "delivered" only after the send is
confirmed - new chats with no URL id yet - duplicate message text (bookmark keys include the
predecessor) - lazy-loaded history - text matches spanning inline markup, never across
paragraphs, case-folding that never changes length (Turkish İ) - rows Gemini reuses for
another chat - sidebar collapsed to the icon rail - narrow viewports (bar density) - RTL
and per-script token weights - quotes in attribute text - Windows reserved filenames, bidi
and zero-width characters, emoji at truncation points - UTF-8 BOM for .txt but not .json -
clipboard API refusal (execCommand fallback) - touch devices (no hover tooltips) - hidden
tabs (no scans) - concurrent PDF requests - second tab changing data mid-rename.

## Testing

```
npm run lint            ESLint (no-undef catches missing imports after refactors)
npm test                unit tests (node:test + jsdom): text, tokens, schema, store, app, i18n, pagination…
npm run test:browser    real Chromium (puppeteer-core + @sparticuz/chromium) against a Gemini-like fixture:
                        injection, layout geometry, search, folders, tone/send guards, popovers, PDF (incl. a
                        95 000 px chat), lifecycle, performance
npm run check           all of the above
```

`tests/fixtures/gemini.html` approximates Gemini's markup. It is a stand-in: a live
smoke test against the real site after each Gemini release is still worthwhile.
