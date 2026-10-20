/** JSON / plain-text serialisation + file download. PDF lives in ./pdf/. */
import { HOST_NAME } from '../../core/config.js';
import { bus } from '../../core/events.js';
import { Store } from '../../core/store.js';
import { GeminiHost as host } from '../../host/gemini.js';
import { Lang } from '../../i18n/index.js';
import { htmlNodeToPlainText } from '../../util/plaintext.js';
import { recordToMarkdown } from './serialize/documents.js';
import { folderPathOf, recordToObsidian } from './serialize/obsidian.js';
import { makeRecord } from './serialize/record.js';

let sink = null;
function htmlToText(html) {
  sink ??= document.createElement('div');
  sink.innerHTML = html;
  const text = htmlNodeToPlainText(sink);
  sink.textContent = '';
  return text;
}

export function plainMessages(conversation) {
  return conversation.messages.map((m) => ({
    role: m.role,
    content: m.isHTML ? htmlToText(m.content) : (m.content || '').trim(),
  }));
}

export function toPlainText(conversation) {
  const title = conversation.title || 'Conversation';
  const lines = [title, '='.repeat(Array.from(title).length), ''];
  for (const { role, content } of plainMessages(conversation)) {
    lines.push(role === 'user' ? 'You:' : `${HOST_NAME}:`, content || '(empty)', '');
  }
  const saved = conversation.saved;
  if (saved) {
    const note = (n) => (n ? [`  ${Lang.t('saved.note')}: ${n.replace(/\n/g, '\n  ')}`] : []);
    lines.push(`${Lang.t('saved.title')}:`);
    for (const b of saved.bookmarks) lines.push(`* ${b.snippet}`, ...note(b.note));
    for (const h of saved.highlights) lines.push(`* "${h.quote}"`, ...note(h.note));
    lines.push('');
  }
  return lines.join('\n').trim() + '\n';
}

export function toJSON(conversation) {
  return JSON.stringify(
    {
      title: conversation.title || 'Conversation',
      source: HOST_NAME,
      exportedAt: new Date().toISOString(),
      locale: Lang.locale(),
      messages: plainMessages(conversation),
      ...(conversation.saved ? { saved: conversation.saved } : {}),
    },
    null,
    2,
  );
}

export function downloadTextFile(content, filename, mimeType, { bom = false } = {}) {
  // A BOM makes Windows tools open UTF-8 (Arabic/Chinese/emoji) .txt correctly,
  // but is invalid in JSON, so only plain text asks for it.
  downloadBlob(new Blob(bom ? ['\ufeff', content] : [content], { type: `${mimeType};charset=utf-8` }), filename);
}

/** Save a Blob through a temporary link. Parts-based callers: `downloadBlob(new Blob(parts, { type }), name)`. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.setAttribute('data-gemly-owned', '');
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000); // big ZIPs: keep the URL alive while the save finishes
}

/** Role labels for generated documents (the host name only describes who answered). */
export const roleLabels = () => ({ user: Lang.t('pdf.you'), assistant: HOST_NAME, saved: Lang.t('saved.title'), note: Lang.t('saved.note') });

/** Live-page conversation -> ChatRecord. The id falls back for replies / unsaved chats. */
export function conversationToRecord(conversation, id = host.currentConversationId() || 'local') {
  return makeRecord({ id, conversation, path: host.currentConversationId() ? location.pathname : null });
}

/** @returns {boolean} false when there is nothing to export */
export function downloadAs(conversation, baseFilename, format) {
  if (!conversation?.messages?.length) return false;
  if (format === 'json') downloadTextFile(toJSON(conversation), `${baseFilename}.json`, 'application/json');
  else if (format === 'md' || format === 'obsidian') {
    const rec = conversationToRecord(conversation);
    if (!rec) return false;
    const labels = roleLabels();
    const md =
      format === 'md'
        ? recordToMarkdown(rec, { labels })
        : recordToObsidian(rec, {
            labels,
            origin: location.origin,
            exportedAt: new Date().toISOString(),
            folders: folderPathOf(rec.id, { folders: Store.get('folders'), assignments: Store.get('assignments') }),
          });
    downloadTextFile(md, `${baseFilename}.md`, 'text/markdown');
  } else downloadTextFile(toPlainText(conversation), `${baseFilename}.txt`, 'text/plain', { bom: true });
  bus.emit('activity', { kind: 'export' });
  return true;
}
