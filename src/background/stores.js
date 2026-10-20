/** Archive database layout (shared by archive.js and search-index.js; no imports, so no cycles). */
export const DB_NAME = 'gemly-archive';
/** 1: chats, meta.  2: + postings, terms (search index). */
export const DB_VERSION = 2;
export const STORES = Object.freeze({ chats: 'chats', meta: 'meta', postings: 'postings', terms: 'terms' });
