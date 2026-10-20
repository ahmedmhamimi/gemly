/**
 * Folders: colour-coded, nestable, collapsible folders in the sidebar above
 * Gemini's chat list. Drag a chat onto a folder, or use the folder button that
 * appears on each row. Chats stay in Gemini's own list too - folders are a
 * view layered on top; nothing in the Gemini account is changed.
 *
 * Data operations live in ./model.js; this file is rendering + event wiring.
 */
import { CONFIG, IDS } from '../../core/config.js';
import { bus } from '../../core/events.js';
import { Store } from '../../core/store.js';
import { GeminiHost as host } from '../../host/gemini.js';
import { Lang } from '../../i18n/index.js';
import { icon } from '../../ui/icons.js';
import { Popover } from '../../ui/popover.js';
import { Toast } from '../../ui/toast.js';
import { isOwn, rafThrottle } from '../../util/dom.js';
import { escapeHtml } from '../../util/text.js';
import { mountSidebarBlock, unmountSidebarBlocks } from '../sidebar/blocks.js';
import * as model from './model.js';

const ORDER = 20;
const ROW_ATTR = 'data-gemly-row';

let draggingConvId = null;
let renaming = false; // a re-render mid-rename would eat the edit
let dirtyWhileRenaming = false;

const linkOf = (row) => (row.matches(host.selectors.conversationLink) ? row : row.querySelector(host.selectors.conversationLink));
const liveLink = (convId) => host.sidebarLinks().find((a) => host.conversationId(a.getAttribute('href')) === convId) || null;
const folderIcon = (color) => icon('folder', 18, { fill: color, stroke: color });

// ------------------------------------------------------------------ navigation

function openConversation(convId) {
  const live = liveLink(convId);
  if (live) return void live.click();
  const path = Store.get('convMeta')[convId]?.path;
  if (path) location.assign(path);
}

// --------------------------------------------------------------------- render

const render = rafThrottle(() => {
  if (renaming) {
    dirtyWhileRenaming = true;
    return;
  }
  const list = document.getElementById(IDS.folderList);
  if (!list) return;
  const folders = Store.get('folders');
  const assignments = Store.get('assignments');
  if (!folders.length) {
    const empty = document.createElement('div');
    empty.className = 'gl-folders__empty';
    empty.textContent = Lang.t('folders.empty');
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(...model.childrenOf(folders, null).map((f) => buildFolder(f, folders, assignments, 0)));
});

function buildFolder(folder, folders, assignments, depth) {
  const state = Store.get('folderState');
  const open = !!state[folder.id];
  const canNest = depth < CONFIG.folders.maxDepth - 1;

  const wrap = document.createElement('div');
  wrap.className = 'gl-folder';
  wrap.dataset.folderId = folder.id;

  const head = document.createElement('div');
  head.className = 'gl-folder-head';
  head.dataset.open = String(open);
  head.dataset.folderId = folder.id;
  head.tabIndex = 0;
  head.setAttribute('role', 'button');
  head.setAttribute('aria-expanded', String(open));
  head.innerHTML =
    `<span class="gl-folder-chev">${icon('chevronRight', 12)}</span>` +
    `<span class="gl-folder-icon">${folderIcon(folder.color)}</span>` +
    `<span class="gl-folder-name" dir="auto">${escapeHtml(folder.name)}</span>` +
    `<span class="gl-folder-count">${model.countIn(folders, assignments, folder.id)}</span>` +
    '<span class="gl-folder-actions"></span>';

  const actions = head.querySelector('.gl-folder-actions');
  if (canNest) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'gl-icon-btn';
    add.dataset.glTip = Lang.t('folders.menu.addSub');
    add.setAttribute('aria-label', Lang.t('folders.menu.addSub'));
    add.innerHTML = icon('plus', 14);
    add.addEventListener('click', (e) => {
      e.stopPropagation();
      createAndRename(Lang.t('folders.new.subname'), folder.color, folder.id);
    });
    actions.appendChild(add);
  }
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'gl-icon-btn';
  more.dataset.glTip = Lang.t('folders.options.title');
  more.setAttribute('aria-label', Lang.t('folders.options.title'));
  more.innerHTML = icon('more', 14);
  more.addEventListener('click', (e) => {
    e.stopPropagation();
    openFolderMenu(folder, more, canNest);
  });
  actions.appendChild(more);

  const toggle = () => {
    Store.update('folderState', (s) => {
      if (s[folder.id]) delete s[folder.id];
      else s[folder.id] = true;
    });
    render();
  };
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', (e) => {
    if (e.target !== head) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    } else if (e.key === 'F2') {
      startRename(folder.id);
    }
  });
  head.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    startRename(folder.id);
  });

  // drop target
  head.addEventListener('dragover', (e) => {
    if (!draggingConvId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    head.dataset.drop = 'true';
  });
  head.addEventListener('dragleave', (e) => {
    if (!head.contains(e.relatedTarget)) delete head.dataset.drop;
  });
  head.addEventListener('drop', (e) => {
    if (!draggingConvId) return;
    e.preventDefault();
    delete head.dataset.drop;
    assign(draggingConvId, folder.id);
    draggingConvId = null;
  });
  wrap.appendChild(head);

  if (open) {
    const body = document.createElement('div');
    body.className = 'gl-folder-body';
    const children = model.childrenOf(folders, folder.id);
    const convIds = Object.keys(assignments).filter((c) => assignments[c] === folder.id);
    if (children.length || convIds.length) {
      const inner = document.createElement('div');
      inner.className = 'gl-folder-children';
      children.forEach((c) => inner.appendChild(buildFolder(c, folders, assignments, depth + 1)));
      convIds.forEach((c) => inner.appendChild(buildItem(c, folder)));
      body.appendChild(inner);
    } else {
      const empty = document.createElement('div');
      empty.className = 'gl-folder-empty';
      empty.textContent = Lang.t('folders.empty.drag');
      body.appendChild(empty);
    }
    wrap.appendChild(body);
  }
  return wrap;
}

function buildItem(convId, folder) {
  const live = liveLink(convId);
  const title = (live && host.linkTitle(live)) || Store.get('convMeta')[convId]?.title || Lang.t('folders.untitled');
  const item = document.createElement('div');
  item.className = 'gl-folder-item';
  item.dataset.convId = convId;
  item.dataset.current = String(host.currentConversationId() === convId);
  item.tabIndex = 0;
  item.setAttribute('role', 'link');
  item.innerHTML =
    `<span class="gl-folder-item__dot" style="background:${escapeHtml(folder.color)}"></span>` +
    `<span class="gl-folder-item__title" dir="auto">${escapeHtml(title)}</span>`;
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'gl-icon-btn';
  remove.dataset.glTip = Lang.t('folders.item.remove.title');
  remove.setAttribute('aria-label', Lang.t('folders.item.remove.title'));
  remove.innerHTML = icon('close', 12);
  remove.addEventListener('click', (e) => {
    e.stopPropagation();
    assign(convId, null);
  });
  item.appendChild(remove);
  item.addEventListener('click', () => openConversation(convId));
  item.addEventListener('keydown', (e) => {
    if (e.target === item && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openConversation(convId);
    }
  });
  return item;
}

// -------------------------------------------------------------------- actions

function assign(convId, folderId, link) {
  const l = link || liveLink(convId);
  model.assignChat(convId, folderId, {
    title: l ? host.linkTitle(l) : undefined,
    path: l ? host.pathOf(l.getAttribute('href')) : undefined,
  });
  if (folderId) bus.emit('activity', { kind: 'folder' });
  render();
  syncRows();
}

function createAndRename(name, color, parentId) {
  const folder = model.createFolder({ name, color, parentId });
  if (!folder) return;
  bus.emit('activity', { kind: 'folder' });
  render();
  // The folder renders on the next frame; then start inline rename.
  requestAnimationFrame(() => requestAnimationFrame(() => startRename(folder.id)));
}

function startRename(folderId) {
  const head = document.querySelector(`#${IDS.folderSection} .gl-folder-head[data-folder-id="${folderId}"]`);
  const nameEl = head?.querySelector('.gl-folder-name');
  const folder = Store.get('folders').find((f) => f.id === folderId);
  if (!nameEl || !folder) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'gl-folder-rename';
  input.value = folder.name;
  input.maxLength = CONFIG.folders.maxNameLength;
  input.setAttribute('aria-label', Lang.t('folders.menu.rename'));
  nameEl.replaceWith(input);
  renaming = true;
  input.focus();
  input.select();

  let settled = false;
  const finish = (commit) => {
    if (settled) return;
    settled = true;
    renaming = false;
    if (commit) model.renameFolder(folderId, input.value);
    dirtyWhileRenaming = false;
    render();
  };
  ['click', 'dblclick', 'pointerdown'].forEach((t) => input.addEventListener(t, (e) => e.stopPropagation()));
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

function deleteWithUndo(folder) {
  const snapshot = model.deleteFolder(folder.id);
  render();
  syncRows();
  Toast.show(Lang.t('folders.deleted', { name: folder.name }), {
    action: {
      label: Lang.t('common.undo'),
      onClick: () => {
        model.restoreSnapshot(snapshot);
        render();
        syncRows();
      },
    },
  });
}

// ---------------------------------------------------------------------- menus

function menuItem(label, iconName, handler, danger) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'gl-menu-item';
  b.setAttribute('role', 'menuitem');
  if (danger) b.dataset.danger = 'true';
  b.innerHTML = `<span class="gl-menu-item__icon gl-menu-item__icon--plain">${icon(iconName, 16)}</span><span>${escapeHtml(label)}</span>`;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    Popover.closeAll();
    handler();
  });
  return b;
}

function openFolderMenu(folder, anchor, canNest) {
  const menu = document.createElement('div');
  menu.className = 'gl-ui gl-pop gl-pop--glass gl-folder-menu';
  menu.appendChild(menuItem(Lang.t('folders.menu.rename'), 'edit', () => requestAnimationFrame(() => startRename(folder.id))));
  if (canNest) {
    menu.appendChild(menuItem(Lang.t('folders.menu.addSub'), 'folderPlus', () => createAndRename(Lang.t('folders.new.subname'), folder.color, folder.id)));
  }
  const label = document.createElement('div');
  label.className = 'gl-pop__label';
  label.textContent = Lang.t('folders.menu.color');
  menu.appendChild(label);

  const swatches = document.createElement('div');
  swatches.className = 'gl-swatches';
  for (const c of CONFIG.folders.palette) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gl-swatch';
    b.style.background = c.hex;
    b.dataset.current = String(c.hex.toLowerCase() === folder.color.toLowerCase());
    b.dataset.glTip = Lang.t(`folders.color.${c.name.toLowerCase()}`);
    b.setAttribute('aria-label', Lang.t(`folders.color.${c.name.toLowerCase()}`));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      Popover.closeAll();
      model.recolorFolder(folder.id, c.hex);
      render();
    });
    swatches.appendChild(b);
  }
  menu.appendChild(swatches);
  menu.appendChild(menuItem(Lang.t('folders.menu.delete'), 'trash', () => deleteWithUndo(folder), true));
  Popover.open({ anchor, content: menu, role: 'menu', placement: 'bottom' });
}

function openAssignMenu(convId, link, anchor) {
  const folders = Store.get('folders');
  const current = Store.get('assignments')[convId];
  const menu = document.createElement('div');
  menu.className = 'gl-ui gl-pop gl-pop--glass gl-assign-pop';
  menu.innerHTML = `<div class="gl-pop__label">${escapeHtml(Lang.t('folders.assign.title'))}</div>`;

  if (!folders.length) {
    const empty = document.createElement('div');
    empty.className = 'gl-assign-empty';
    empty.textContent = Lang.t('folders.assign.empty');
    menu.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'gl-assign-list gl-scroll';
    for (const { folder, depth } of model.flatten(folders)) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'gl-assign-row gl-menu-item';
      row.setAttribute('role', 'menuitem');
      row.dataset.current = String(current === folder.id);
      row.style.paddingInlineStart = `${10 + depth * 14}px`;
      row.innerHTML = `${folderIcon(folder.color)}<span class="gl-assign-name" dir="auto">${escapeHtml(folder.name)}</span>`;
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        Popover.closeAll();
        assign(convId, folder.id, link);
      });
      list.appendChild(row);
    }
    menu.appendChild(list);
    if (current) {
      const wrap = document.createElement('div');
      wrap.className = 'gl-assign-remove';
      wrap.appendChild(menuItem(Lang.t('folders.item.remove.title'), 'close', () => assign(convId, null), true));
      menu.appendChild(wrap);
    }
  }
  Popover.open({ anchor, content: menu, role: 'menu', placement: 'bottom' });
}

// ------------------------------------------------------------- sidebar rows

const decorated = new WeakSet();

/** Keeps cached titles/paths fresh and every visible row decorated. Cheap per call. */
function syncRows(links = host.sidebarLinks()) {
  const assignments = Store.get('assignments');
  const meta = Store.get('convMeta');
  const updates = [];

  for (const link of links) {
    const convId = host.conversationId(link.getAttribute('href'));
    if (!convId) continue;
    const assigned = !!assignments[convId];

    if (assigned) {
      const title = host.linkTitle(link);
      const path = host.pathOf(link.getAttribute('href'));
      const m = meta[convId] || {};
      if ((title && m.title !== title) || (path && m.path !== path)) updates.push([convId, title || m.title, path || m.path]);
    }

    const row = host.rowFor(link);
    if (!row) continue;
    if (!decorated.has(row) || !row.querySelector('.gl-row-btn')) {
      decorated.add(row);
      row.setAttribute(ROW_ATTR, 'true');
      if (!row.querySelector('.gl-row-btn')) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gl-ui gl-icon-btn gl-row-btn';
        btn.setAttribute('aria-label', Lang.t('folders.assign.title'));
        btn.dataset.glTip = Lang.t('folders.assign.title');
        btn.innerHTML = icon('folder', 16);
        row.appendChild(btn);
      }
    }
    const btn = row.querySelector('.gl-row-btn');
    const flag = String(assigned);
    if (btn && btn.dataset.assigned !== flag) btn.dataset.assigned = flag;
  }

  if (updates.length) {
    Store.update('convMeta', (m) => {
      for (const [id, title, path] of updates) m[id] = { title: title || '', path: path || null };
    });
    render();
  } else {
    // Highlight the open chat inside folders (attribute only - no re-render).
    const cur = host.currentConversationId();
    document.querySelectorAll(`#${IDS.folderSection} .gl-folder-item`).forEach((el) => {
      const v = String(el.dataset.convId === cur);
      if (el.dataset.current !== v) el.dataset.current = v;
    });
  }
}

function buildSection() {
  const section = document.createElement('div');
  section.id = IDS.folderSection;
  section.className = 'gl-ui gl-folders';
  section.innerHTML =
    `<div class="gl-folders__head"><span class="gl-folders__title">${icon('folder', 13)}${escapeHtml(Lang.t('folders.title'))}</span>` +
    `<button type="button" id="${IDS.folderAddBtn}" class="gl-icon-btn" style="width:26px;height:26px" aria-label="${escapeHtml(Lang.t('folders.add.title'))}" data-gl-tip="${escapeHtml(Lang.t('folders.add.title'))}">${icon('plus', 15)}</button></div>` +
    `<div id="${IDS.folderList}" class="gl-folders__list"></div>`;
  section.querySelector(`#${IDS.folderAddBtn}`).addEventListener('click', (e) => {
    e.stopPropagation();
    createAndRename(Lang.t('folders.new.name'));
  });
  return section;
}

/** @type {import('../../core/app.js').Feature} */
export const foldersFeature = {
  id: 'folders',
  zones: ['sidebar'],

  init(ctx) {
    // Delegated, so rows Gemini re-uses for other chats never hold a stale handler.
    ctx.listen(document, 'click', (e) => {
      const btn = e.target.closest?.('.gl-row-btn');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const row = btn.closest(`[${ROW_ATTR}]`);
      const link = row && linkOf(row);
      const convId = link && host.conversationId(link.getAttribute('href'));
      if (convId) openAssignMenu(convId, link, btn);
    }, true);

    ctx.listen(document, 'dragstart', (e) => {
      const link = e.target.closest?.(host.selectors.conversationLink);
      if (!link || isOwn(link)) return;
      const id = host.conversationId(link.getAttribute('href'));
      if (!id || !host.sidebarLinks().includes(link)) return;
      draggingConvId = id;
      try {
        e.dataTransfer.effectAllowed = 'copyMove';
        e.dataTransfer.setData('text/plain', id);
      } catch {
        /* some drags don't allow it */
      }
      host.rowFor(link).classList.add('gl-dragging-source');
    }, true);

    ctx.listen(document, 'dragend', () => {
      draggingConvId = null;
      document.querySelectorAll('.gl-dragging-source').forEach((el) => el.classList.remove('gl-dragging-source'));
      document.querySelectorAll('.gl-folder-head[data-drop]').forEach((el) => delete el.dataset.drop);
    }, true);

    // Another tab changed folders/assignments.
    ctx.onDispose(
      bus.on('store', ({ names }) => {
        if (names.some((n) => ['folders', 'assignments', 'convMeta', 'folderState'].includes(n))) render();
      }),
    );
  },

  scan(scan) {
    let section = document.getElementById(IDS.folderSection);
    if (!section?.isConnected) {
      section = buildSection();
      if (!mountSidebarBlock(section, ORDER)) return;
      model.pruneOrphans();
      render();
    }
    syncRows(scan.links);
    if (dirtyWhileRenaming && !renaming) render();
  },

  teardown() {
    document.getElementById(IDS.folderSection)?.remove();
    document.querySelectorAll('.gl-row-btn').forEach((b) => b.remove());
    document.querySelectorAll(`[${ROW_ATTR}]`).forEach((r) => r.removeAttribute(ROW_ATTR));
    unmountSidebarBlocks();
    Popover.closeAll();
  },
};
