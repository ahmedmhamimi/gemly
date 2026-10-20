/**
 * Wall-clock time of a Gemini reply.
 *
 * Start: when a prompt is sent (bus 'user-sent') or, failing that, the first
 * time Gemini is seen generating (regenerate / edited prompt).
 * End: the moment generation is seen to stop - far closer to the truth than
 * "whenever the badge got drawn". State resets on navigation so one chat's
 * timing is never attributed to another.
 */
import { bus } from '../../core/events.js';

let startedAt = null;
let finishedAt = null;
let wasGenerating = false;

export const GenerationTimer = {
  start() {
    startedAt = Date.now();
    finishedAt = null;
  },

  /** Called every scan with Gemini's generating state. */
  observe(isGenerating) {
    if (isGenerating && !wasGenerating) {
      if (startedAt == null || finishedAt != null) this.start();
    } else if (!isGenerating && wasGenerating && startedAt != null) {
      finishedAt = Date.now();
    }
    wasGenerating = isGenerating;
  },

  /** Seconds of the last finished generation, once; null if unknown. */
  consume() {
    if (startedAt == null || finishedAt == null) return null;
    const s = (finishedAt - startedAt) / 1000;
    startedAt = finishedAt = null;
    return s;
  },

  reset() {
    startedAt = finishedAt = null;
    wasGenerating = false;
  },

  format(seconds) {
    if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
    if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
    return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  },
};

export function wireTimer(ctx) {
  ctx.onDispose(bus.on('user-sent', () => GenerationTimer.start()));
  ctx.onDispose(
    bus.on('generating', ({ on }) => {
      GenerationTimer.observe(on);
      // The reply just finished: its badge can be drawn now, even if the page
      // changed nothing else we would have noticed.
      if (!on) ctx.requestScan('chat');
    }),
  );
  ctx.onDispose(bus.on('navigate', () => GenerationTimer.reset()));
}
