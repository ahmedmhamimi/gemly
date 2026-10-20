/**
 * THE one place that lists every feature and whether it is on.
 *
 * To switch a feature off for everyone (for example after Gemini changed its
 * markup and the feature misbehaves): set `enabled: false` on its row. Nothing
 * else changes - not the feature's code, not main.js. Every facet the row owns
 * (the App feature, bar widgets, message actions, send hooks) goes with it, and
 * rows that `requires` it go off too.
 *
 * To add a feature: create features/<name>/, import it below, add ONE row.
 * Ids must be unique and kebab-case. A widget / action / hook that no row
 * claims still runs (fail-open) but logs a warning, and
 * tests/unit/manifest-features.test.js fails.
 *
 * Row fields (see core/feature-registry.js):
 *   id        unique feature id
 *   enabled   developer kill switch (default true; users cannot override `false`)
 *   locked    users cannot switch it off in Settings
 *   requires  ids that must be on for this one to make sense
 *   app       the Feature object for core/app.js (its `id` must equal this id)
 *   widgets / actions / hooks / sections   ids registered through registerBarWidget /
 *             registerMessageAction / registerSendHook / registerSettingsSection
 *
 * ORDER MATTERS for rows that carry an `app`: it is the init and scan order.
 */
import { Features } from '../core/feature-registry.js';

import { barFeature } from './bar/index.js';
import './bar/separators.js';
import './composer/char-counter.js';
import './composer/context-meter.js';
import { sendHooksFeature } from './composer/send-hooks.js';
import './export/widgets.js';
import { messageActionsFeature } from './message-actions/index.js';
import './message-actions/actions.js';
import { toneFeature } from './tone/index.js';
import { promptsFeature } from './prompts/index.js';
import { bookmarksFeature } from './bookmarks/index.js';
import { chatSearchFeature } from './search/chat-search.js';
import { sidebarSearchFeature } from './sidebar/search.js';
import { foldersFeature } from './folders/index.js';
import { quickActionsFeature } from './quick-actions/index.js';
import { shellFeature } from './shell/index.js';
import { welcomeFeature } from './welcome/index.js';
import { reviewFeature } from './review/index.js';
import { settingsFeature } from './settings/index.js';
import { globalSearchFeature } from './archive-search/index.js';
import { chatIndexFeature } from './archive-search/auto-index.js';
import { bulkManageFeature } from './bulk/index.js';
import { personasFeature } from './personas/index.js';
import './extract/index.js';
import { savedFeature } from './saved/index.js';
import { summarizeFeature } from './summarize/index.js';

/** @type {import('../core/feature-registry.js').FeatureDef[]} */
export const FEATURE_DEFS = [
  // --- infrastructure -----------------------------------------------------------
  { id: 'shell', locked: true, app: shellFeature }, // shared tooltip + storage-error toasts
  { id: 'send-hooks', locked: true, app: sendHooksFeature }, // one Enter/click interceptor for all hooks
  { id: 'bar', app: barFeature, widgets: ['sep-1', 'sep-2'] }, // the strip above the prompt box
  { id: 'message-actions', app: messageActionsFeature }, // cluster inside each reply's action row
  // Settings dialog + its Features section. Locked so nobody can switch off the way back in.
  { id: 'settings', locked: true, app: settingsFeature, widgets: ['settings'], sections: ['features'] },

  // --- bar widgets ---------------------------------------------------------------
  { id: 'tone', app: toneFeature, widgets: ['tone'], hooks: ['tone'], requires: ['bar', 'send-hooks'] },
  { id: 'prompts', app: promptsFeature, widgets: ['prompts'] },
  // Running a prompt with follow-up steps as a chain (without it, only the first step is inserted).
  { id: 'prompt-chains', requires: ['prompts'] },
  // Saved custom-instruction profiles: one click starts a chat with one; Alt+Shift+P quick switcher.
  { id: 'personas', app: personasFeature, widgets: ['personas'] },
  { id: 'char-counter', widgets: ['char-counter'] },
  { id: 'context-meter', widgets: ['context-meter'] },
  { id: 'copy-conversation', widgets: ['copy-conversation'] },
  { id: 'export', widgets: ['export'], actions: ['download'] },

  // --- per-reply buttons ---------------------------------------------------------
  { id: 'token-badge', actions: ['token-badge'] },
  // Copy / download the code blocks and tables of a reply (CSV, Excel).
  { id: 'extract', actions: ['extract'] },
  { id: 'copy-plain', actions: ['copy-plain'] },

  // --- page features -------------------------------------------------------------
  // Search across all saved chats (dialog, Alt+Shift+F, Settings section) and the automatic saving of opened chats that feeds it.
  { id: 'global-search', app: globalSearchFeature, widgets: ['global-search'], sections: ['search-index'] },
  { id: 'chat-index', app: chatIndexFeature },
  // Multi-select in the sidebar: move / tag / archive; delete (via Gemini's own chat menu) is switchable on its own.
  { id: 'bulk-manage', app: bulkManageFeature },
  { id: 'bulk-delete', requires: ['bulk-manage'] },
  // Text highlights + notes (also on starred messages), the Saved panel, and their inclusion in exports.
  { id: 'saved', app: savedFeature, widgets: ['saved'] },
  // Summarize the chat through the normal prompt box, then continue in a new chat with the summary pre-filled.
  { id: 'summarize', app: summarizeFeature, widgets: ['summarize'], sections: ['summary'] },
  { id: 'bookmarks', app: bookmarksFeature },
  { id: 'chat-search', app: chatSearchFeature },
  { id: 'sidebar-search', app: sidebarSearchFeature },
  { id: 'folders', app: foldersFeature },
  { id: 'quick-actions', app: quickActionsFeature },

  // --- one-time surfaces ---------------------------------------------------------
  { id: 'welcome', app: welcomeFeature },
  { id: 'review', app: reviewFeature },
];

Features.define(FEATURE_DEFS);

/** The App Features, in manifest order. App itself skips the ones that are off. */
export const appFeatures = () => FEATURE_DEFS.filter((d) => d.app).map((d) => d.app);
