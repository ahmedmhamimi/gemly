import { bus } from '../../core/events.js';
import { ReviewPrompt } from './review-prompt.js';

/**
 * Review prompt. Listens to the shared 'activity' event (emitted by features
 * when something valuable happened) so no feature needs to know it exists.
 * Dormant until CONFIG.store.reviewsUrl is set.
 */
/** @type {import('../../core/app.js').Feature} */
export const reviewFeature = {
  id: 'review',
  zones: [],
  init(ctx) {
    ReviewPrompt.init();
    ctx.onDispose(bus.on('activity', ({ kind }) => void ReviewPrompt.track(kind)));
  },
  teardown() {
    document.getElementById(ReviewPrompt._HOST_ID)?.remove();
  },
};
