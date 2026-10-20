/**
 * Settings > Search index: how much is indexed, and a Rebuild action
 * (clear, then re-index every saved chat in small cancellable batches).
 */
import { ArchiveClient } from '../../core/archive-client.js';
import { chunk, runJob } from '../../core/jobs.js';
import { createLogger } from '../../core/log.js';
import { Lang } from '../../i18n/index.js';
import { createProgress } from '../../ui/progress.js';
import { Toast } from '../../ui/toast.js';
import { h } from '../../util/dom.js';
import { infoIcon } from '../../ui/info.js';
import { registerSettingsSection } from '../settings/registry.js';

const log = createLogger('index-settings');
const BATCH = 25;

function build() {
  const root = h('div');
  const line = h('p', { cls: 'gl-modal__hint' });
  const progress = createProgress();
  progress.el.hidden = true;
  const rebuild = h('button', { cls: 'gl-btn', attrs: { type: 'button' }, text: Lang.t('gsearch.rebuild') });
  const cancel = h('button', { cls: 'gl-btn', attrs: { type: 'button' }, text: Lang.t('backup.cancel') });
  cancel.hidden = true;
  const note = h('p', { cls: 'gl-modal__hint', text: Lang.t('gsearch.privacy') });

  async function refresh() {
    try {
      const s = await ArchiveClient.indexStats();
      line.textContent = Lang.t(s.chats < s.archived ? 'gsearch.index.partial' : 'gsearch.index.stats', { indexed: s.chats, total: s.archived, n: s.chats });
    } catch {
      line.textContent = Lang.t('gsearch.index.unavailable');
    }
  }

  let ac = null;
  cancel.addEventListener('click', () => ac?.abort());
  rebuild.addEventListener('click', async () => {
    ac = new AbortController();
    rebuild.disabled = true;
    cancel.hidden = false;
    progress.el.hidden = false;
    progress.state('running');
    try {
      const ids = (await ArchiveClient.list()).map((r) => r.id);
      await ArchiveClient.indexClear();
      const batches = chunk(ids, BATCH);
      let done = 0;
      progress.set(0, Lang.t('gsearch.rebuilding', { done: 0, total: ids.length }));
      const res = await runJob({
        items: batches,
        signal: ac.signal,
        retries: 1,
        worker: async (batch) => {
          await ArchiveClient.indexBatch(batch);
          done += batch.length;
        },
        onProgress: () => progress.set(ids.length ? done / ids.length : 1, Lang.t('gsearch.rebuilding', { done, total: ids.length })),
      });
      const ok = !res.cancelled && !res.failed;
      progress.state(ok ? 'done' : 'error');
      progress.set(1, Lang.t(res.cancelled ? 'gsearch.rebuild.cancelled' : res.failed ? 'gsearch.rebuild.failed' : 'gsearch.rebuild.done'));
      if (ok) Toast.show(Lang.t('gsearch.rebuild.done'));
    } catch (err) {
      log.error('rebuild failed', err);
      progress.state('error');
      progress.set(1, Lang.t('gsearch.rebuild.failed'));
      Toast.show(Lang.t('gsearch.rebuild.failed'));
    } finally {
      ac = null;
      rebuild.disabled = false;
      cancel.hidden = true;
      refresh();
    }
  });

  refresh();
  root.append(line, h('div', { attrs: { style: 'display:flex;align-items:center;gap:8px' }, children: [rebuild, cancel, infoIcon(Lang.t('gsearch.rebuild.info'))] }), progress.el, note);
  return root;
}

registerSettingsSection({ id: 'search-index', order: 30, title: () => Lang.t('gsearch.settings.title'), build });
