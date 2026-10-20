/**
 * Creates one Gemly cluster inside every reply's action row and hosts the
 * registered MessageActions in it. Idempotent: a cluster Gemini re-rendered
 * away is simply rebuilt on the next scan.
 */
import { wireTimer } from './timer.js';
import { messageActions } from './registry.js';

const CLUSTER_CLASS = 'gl-msg-actions';

/** @type {import('../../core/app.js').Feature} */
export const messageActionsFeature = {
  id: 'message-actions',
  zones: ['chat'],
  init(ctx) {
    wireTimer(ctx);
  },
  scan(scan, ctx) {
    const turns = scan.turns;
    const lastIndex = turns.length - 1;

    turns.forEach((turn, i) => {
      if (ctx.host.isUserTurn(turn) || !ctx.host.assistantRoot(turn)) return;
      const isLast = i === lastIndex;
      let cluster = turn.querySelector(`.${CLUSTER_CLASS}`);
      if (!cluster) {
        // A reply still streaming has no (or a hidden) action row; wait for it.
        if (isLast && scan.generating) return;
        const anchor = ctx.host.actionAnchor(turn);
        if (!anchor) return;
        cluster = document.createElement('span');
        cluster.className = `gl-ui ${CLUSTER_CLASS}`;
        for (const a of messageActions()) {
          const el = a.build(turn, ctx);
          el.dataset.glAction = a.id;
          cluster.appendChild(el);
        }
        anchor.row.insertBefore(cluster, anchor.after ? anchor.after.nextSibling : null);
      }
      for (const a of messageActions()) {
        const el = cluster.querySelector(`[data-gl-action="${a.id}"]`);
        if (el && a.update) a.update(el, turn, { isLast, generating: scan.generating }, ctx);
      }
    });
  },
  teardown() {
    document.querySelectorAll(`.${CLUSTER_CLASS}`).forEach((el) => el.remove());
  },
};
