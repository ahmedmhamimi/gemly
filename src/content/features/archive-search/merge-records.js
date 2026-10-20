/**
 * Merge a possibly PARTIAL view of a chat into what the archive already holds.
 *
 * Gemini only renders the most recent messages of a long chat until you scroll
 * up, so the page often shows a slice. Saving that slice over a full copy would
 * destroy history. Instead the slice is aligned to the stored messages:
 *
 *   stored   m0 m1 m2 m3 m4 m5          slice  m4 m5' m6      ->  m0 m1 m2 m3 m4 m5' m6
 *
 * The last overlapping pair may differ (a reply that was streaming or was
 * regenerated); everything before it must match exactly. With no overlap the
 * longer side wins (an explicit re-capture replaces). Pure.
 */

const key = (m) => `${m.role}\u0001${m.text}`;

/** Where does `b` start inside `a`? Returns the index in `a`, or -1. */
function alignAt(a, b) {
  if (!b.length) return -1;
  outer: for (let j = 0; j < a.length; j++) {
    if (a[j].role !== b[0].role) continue;
    const n = Math.min(a.length - j, b.length);
    for (let k = 0; k < n; k++) {
      const last = k === n - 1;
      if (key(a[j + k]) === key(b[k])) continue;
      if (last && n > 1 && a[j + k].role === b[k].role) continue; // the final pair may have changed
      continue outer;
    }
    // A one-message overlap must match exactly, otherwise any message would "align".
    if (n === 1 && key(a[j]) !== key(b[0])) continue;
    return j;
  }
  return -1;
}

/**
 * @param {object|null|undefined} existing ChatRecord from the archive
 * @param {object} incoming ChatRecord just read from the page
 * @returns {object} merged ChatRecord (never mutates its inputs)
 */
export function mergeRecords(existing, incoming) {
  if (!existing || !existing.messages?.length) return incoming;
  if (!incoming.messages.length) return existing;
  const E = existing.messages;
  const I = incoming.messages;
  let messages;

  const j = alignAt(E, I); // the slice starts inside what we stored
  if (j >= 0) {
    messages = [...E.slice(0, j), ...I, ...E.slice(j + I.length)];
  } else {
    const i = alignAt(I, E); // what we stored starts inside the slice (the slice reaches further back)
    if (i >= 0) {
      const overlap = Math.min(I.length - i, E.length);
      messages = [...I, ...E.slice(overlap)];
    } else {
      messages = I.length >= E.length ? I : E; // no overlap: the longer side wins
    }
  }
  return {
    ...incoming,
    title: incoming.title || existing.title,
    path: incoming.path || existing.path,
    capturedAt: Math.max(existing.capturedAt || 0, incoming.capturedAt || 0),
    messages,
  };
}
