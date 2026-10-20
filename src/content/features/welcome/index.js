import { Welcome } from './welcome.js';

/** One-time welcome card shown after install (the background worker hands it to exactly one tab). */
/** @type {import('../../core/app.js').Feature} */
export const welcomeFeature = {
  id: 'welcome',
  zones: [],
  init() {
    Welcome.maybeShow();
  },
  teardown() {
    document.getElementById(Welcome._HOST_ID)?.remove();
  },
};
