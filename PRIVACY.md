# Privacy: what the extension stores and what it can send

*A draft for your Chrome Web Store privacy tab and policy. Review it with whoever owns your legal text.*

## What is stored, and where
| Data | Where | Leaves the device? |
|---|---|---|
| Folders, tags, archive flags, bookmarks, highlights and notes, prompts, personas, tone and feature settings | `chrome.storage.local` | **No** |
| Saved copies of chats you opened, and the search index | IndexedDB of the extension's service worker (the extension's origin; the website cannot read it) | **No** |

Chats are saved automatically when you open them (so they can be searched). This can be switched off
in Settings > Features ("Automatic saving of opened chats").
No chat or user content is collected by the developer. There are no analytics, ads or trackers.

## Nothing is sent anywhere
The extension has no sync, no cloud export and no network features. It makes no requests of its own;
files you export (PDF, text, Markdown, Obsidian, JSON) are created on your device and downloaded by your browser.

## Permissions, and why
- `storage`: all of the above.
- `scripting`: loads the PDF engine into the page on demand.
- `https://gemini.google.com/*`: the site the extension works on.

There are no optional permissions and no options page.

## Not collected
No analytics, no usage statistics, no identifiers, no remote configuration, no remote code.
