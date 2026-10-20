/**
 * Shell services that belong to no single feature: the shared tooltip and
 * user-visible notices for storage problems.
 */
import { bus } from '../../core/events.js';
import { Lang } from '../../i18n/index.js';
import { createTooltip } from '../../ui/tooltip.js';
import { Toast } from '../../ui/toast.js';

/** @type {import('../../core/app.js').Feature} */
export const shellFeature = {
  id: 'shell',
  zones: [],
  init(ctx) {
    ctx.onDispose(createTooltip());

    // At most one storage-error toast per 30 s so a failing save loop can't spam.
    let last = 0;
    ctx.onDispose(
      bus.on('store-error', ({ quota }) => {
        if (Date.now() - last < 30000) return;
        last = Date.now();
        Toast.show(Lang.t(quota ? 'store.error.quota' : 'store.error.generic'), { ms: 5000 });
      }),
    );
  },
};
