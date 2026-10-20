import test from 'node:test';
import assert from 'node:assert/strict';

// The feature modules touch `window`/`document` only at import time in trivial ways;
// minimal stubs are enough to load the real registrations (no jsdom needed).
globalThis.window ??= globalThis;
globalThis.document ??= { addEventListener() {}, removeEventListener() {}, documentElement: {}, querySelectorAll: () => [] };
globalThis.chrome ??= { runtime: { id: 'test' } };

const { FEATURE_DEFS, appFeatures } = await import('../../src/content/features/manifest.js');
const { Features, resolveFlags } = await import('../../src/content/core/feature-registry.js');
const { barWidgets, registeredBarWidgetIds } = await import('../../src/content/features/bar/registry.js');
const { messageActions, registeredMessageActionIds } = await import('../../src/content/features/message-actions/registry.js');
const { registeredSendHookIds } = await import('../../src/content/features/composer/send-hooks.js');
const { registeredSettingsSectionIds, settingsSections } = await import('../../src/content/features/settings/registry.js');
const en = (await import('../../src/content/i18n/en.js')).default;

const ids = (list) => list.map((x) => x.id);

test('manifest: ids are unique and the App features keep their historical init/scan order', () => {
  assert.equal(new Set(ids(FEATURE_DEFS)).size, FEATURE_DEFS.length);
  assert.deepEqual(ids(appFeatures()), [
    'shell', 'send-hooks', 'bar', 'message-actions', 'settings', 'tone', 'prompts', 'personas', 'global-search', 'chat-index', 'bulk-manage', 'saved', 'summarize', 'bookmarks',
    'chat-search', 'sidebar-search', 'folders', 'quick-actions', 'welcome', 'review',
  ]);
});

test('manifest: every registered widget / action / hook is owned by a feature (nothing can be forgotten)', () => {
  for (const [kind, list] of [
    ['widget', registeredBarWidgetIds()],
    ['action', registeredMessageActionIds()],
    ['hook', registeredSendHookIds()],
    ['section', registeredSettingsSectionIds()],
  ]) {
    assert.ok(list.length > 0, `${kind}s are registered`);
    for (const id of list) assert.ok(Features.ownerOf(kind, id), `${kind} "${id}" has no owner in features/manifest.js`);
  }
});

test('manifest: every facet a row claims really exists (no typos, no stale entries)', () => {
  const registered = { widget: registeredBarWidgetIds(), action: registeredMessageActionIds(), hook: registeredSendHookIds(), section: registeredSettingsSectionIds() };
  for (const d of FEATURE_DEFS) {
    for (const kind of ['widget', 'action', 'hook', 'section']) {
      for (const id of d[`${kind}s`] || []) assert.ok(registered[kind].includes(id), `row "${d.id}" claims ${kind} "${id}" which is not registered`);
    }
  }
});

test('everything is on by default and nothing is on the user-override path yet', () => {
  Features.resolve({});
  assert.deepEqual(Features.report().filter((r) => !r.enabled), []);
  assert.deepEqual(ids(barWidgets()), ['tone', 'personas', 'prompts', 'sep-1', 'char-counter', 'context-meter', 'sep-2', 'copy-conversation', 'export', 'saved', 'global-search', 'summarize', 'settings']);
  assert.deepEqual(ids(messageActions()), ['token-badge', 'copy-plain', 'download', 'extract']);
});

test('switching one feature off removes ALL of its facets and nothing else', () => {
  Features.resolve({ tone: false });
  assert.ok(!ids(barWidgets()).includes('tone'));
  assert.equal(Features.isFacetEnabled('hook', 'tone'), false);
  assert.ok(ids(barWidgets()).includes('prompts'));

  Features.resolve({ export: false });
  assert.ok(!ids(barWidgets()).includes('export'));
  assert.deepEqual(ids(messageActions()), ['token-badge', 'copy-plain', 'extract'], 'the per-reply download goes with the bar button');
  assert.ok(ids(barWidgets()).includes('copy-conversation'), 'copy is a separate feature');

  Features.resolve({ 'token-badge': false, 'copy-plain': false });
  assert.deepEqual(ids(messageActions()), ['download', 'extract']);
  Features.resolve({});
});

test('tone cannot run without its bar chip and send hook (no invisible tag injection)', () => {
  Features.resolve({ bar: false });
  assert.equal(Features.isEnabled('tone'), false);
  assert.equal(Features.isFacetEnabled('hook', 'tone'), false);
  Features.resolve({});
  Features.resolve({ 'send-hooks': false }); // locked: ignored
  assert.equal(Features.isEnabled('send-hooks'), true);
  Features.resolve({});
});

test('infrastructure rows are locked, and the developer kill switch really kills', () => {
  for (const id of ['shell', 'send-hooks', 'settings']) assert.equal(FEATURE_DEFS.find((d) => d.id === id).locked, true);
  const killed = FEATURE_DEFS.map((d) => (d.id === 'folders' ? { ...d, enabled: false } : d));
  const flags = resolveFlags(killed, { folders: true });
  assert.equal(flags.get('folders').enabled, false);
  assert.equal(flags.get('bookmarks').enabled, true);
});

test('bar / message-action lists are memoised per registry version', () => {
  Features.resolve({});
  const a = barWidgets();
  assert.equal(barWidgets(), a, 'same array while nothing changed');
  Features.resolve({ tone: false });
  assert.notEqual(barWidgets(), a);
  Features.resolve({});
});

test('every feature has a localised title (shown in Settings > Features)', () => {
  for (const d of FEATURE_DEFS) assert.ok(en[`feature.${d.id}.title`], `missing i18n key feature.${d.id}.title`);
});

test('every feature has a plain-language explanation (the "i" in Settings > Features)', () => {
  for (const d of FEATURE_DEFS) assert.ok(en[`feature.${d.id}.info`], `missing i18n key feature.${d.id}.info`);
});

test('settings sections follow their owner', () => {
  assert.deepEqual(ids(settingsSections()), ['features', 'summary', 'search-index']);
  Features.resolve({ 'global-search': false });
  assert.deepEqual(ids(settingsSections()), ['features', 'summary'], 'the index section goes with its feature');
  Features.resolve({});
});

test('bulk delete can be switched off alone; switching bulk management off takes delete with it', () => {
  Features.resolve({ 'bulk-delete': false });
  assert.equal(Features.isEnabled('bulk-manage'), true);
  assert.equal(Features.isEnabled('bulk-delete'), false);
  Features.resolve({ 'bulk-manage': false });
  assert.equal(Features.isEnabled('bulk-delete'), false);
  Features.resolve({});
});
