/**
 * Automatic saving of the chats you open ("chats the extension has seen"), so
 * they become searchable. Event-driven only: it runs a few seconds after a chat
 * is opened or after a reply finishes, never on a timer and never per mutation.
 *
 * The page may show only the latest messages of a long chat; the worker aligns
 * that slice to the stored copy (putSeen) instead of replacing it.
 * Switch it off in Settings > Features ("Automatic saving of opened chats").
 */
import { ArchiveClient } from '../../core/archive-client.js';
import { bus } from '../../core/events.js';
import { createLogger } from '../../core/log.js';
import { GeminiHost as host } from '../../host/gemini.js';
import { extractConversation } from '../export/extractor.js';
import { makeRecord, recordSignature } from '../export/serialize/record.js';

const log = createLogger('auto-index');
const SETTLE_MS = 4000;
const AFTER_REPLY_MS = 1500;
const MAX_FAILURES = 3;

const whenIdle = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 0));

/** @type {import('../../core/app.js').Feature} */
export const chatIndexFeature = {
  id: 'chat-index',
  zones: [],
  init(ctx) {
    let timer = 0;
    let failures = 0;
    const lastSig = new Map(); // chat id -> signature already sent this session

    const capture = () => {
      if (failures >= MAX_FAILURES || document.visibilityState !== 'visible' || host.isGenerating()) return;
      const id = host.currentConversationId();
      if (!id) return;
      whenIdle(async () => {
        let rec;
        try {
          rec = makeRecord({ id, conversation: extractConversation(), path: location.pathname });
        } catch (err) {
          log.debug('could not read the open chat', err);
          return;
        }
        if (!rec) return;
        const sig = recordSignature(rec);
        if (lastSig.get(id) === sig) return;
        try {
          await ArchiveClient.putSeen([rec]);
          lastSig.set(id, sig);
          failures = 0;
        } catch (err) {
          failures++; // e.g. the extension was updated; stop after a few tries instead of retrying forever
          log.debug('could not save the open chat', err);
        }
      });
    };
    const schedule = (ms) => {
      clearTimeout(timer);
      timer = setTimeout(capture, ms);
    };

    ctx.onDispose(bus.on('navigate', () => schedule(SETTLE_MS)));
    ctx.onDispose(bus.on('generating', ({ on }) => !on && schedule(AFTER_REPLY_MS)));
    ctx.onDispose(() => clearTimeout(timer));
    schedule(SETTLE_MS);
  },
};
