/**
 * Traceability helpers: a health check that warns (once) when Gemini's markup
 * no longer matches Gemly's selectors, and a `diagnose()` report you can run
 * from DevTools (select the extension's context in the console dropdown):
 *
 *     __gemly.diagnose()
 */
import { Features } from './feature-registry.js';
import { INSTANCE_ID } from './lifecycle.js';
import { createLogger } from './log.js';
import { GeminiHost as host } from '../host/gemini.js';

const log = createLogger('health');

export function diagnose(app) {
  return {
    instance: INSTANCE_ID,
    url: location.pathname,
    conversationId: host.currentConversationId(),
    turns: host.turns().length,
    sidebarLinks: host.sidebarLinks().length,
    editor: !!host.editor(),
    composerRoot: !!host.composerRoot(),
    generating: host.isGenerating(),
    scans: app.scanCount,
    features: app.featureStatus(),
    inactive: app.inactive,
    featureFlags: Features.report(),
    selectors: host.probe(),
  };
}

/**
 * Cheap structural sanity check, throttled by the caller. Each problem is
 * logged once with a pointer to the fix location.
 */
export function healthCheck() {
  const onConversation = !!host.currentConversationId();
  if (!host.editor()) {
    log.warnOnce('editor', 'prompt box not found - update SELECTORS.editor in host/gemini.js');
  }
  if (onConversation && host.turns().length === 0) {
    log.warnOnce('turns', 'on a chat route but no turns found - update SELECTORS.turns in host/gemini.js');
  }
  if (host.conversationsList() && host.sidebarLinks().length === 0) {
    log.warnOnce('links', 'chat list found but no chat links - update SELECTORS.conversationLink in host/gemini.js');
  }
}
