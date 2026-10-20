/**
 * Find a highlighted quote inside a message's text nodes (pure).
 *
 * Highlights are stored as text, not as DOM positions, because Gemini re-renders
 * messages freely. To paint one again the quote is searched for in the message's
 * current text nodes. Matching ignores ALL whitespace on both sides: what a person
 * selects (`selection.toString()`) differs from the concatenated text nodes in newlines
 * and spaces at block boundaries, and a whitespace-insensitive match is immune to that.
 *
 * `chunks` are the text-node strings in document order.
 */

const WS = /\s/;

function compact(chunks) {
  let text = '';
  const map = []; // map[i] = { c: chunk index, o: offset in that chunk } for text[i]
  chunks.forEach((chunk, c) => {
    for (let o = 0; o < chunk.length; o++) {
      if (WS.test(chunk[o])) continue;
      text += chunk[o];
      map.push({ c, o });
    }
  });
  return { text, map };
}

/**
 * Every occurrence of `quote`, in order.
 * @returns {{ start: { chunk: number, offset: number }, end: { chunk: number, offset: number } }[]}
 */
export function locateAll(chunks, quote) {
  const q = String(quote ?? '').replace(/\s+/g, '');
  if (!q) return [];
  const { text, map } = compact(chunks);
  const out = [];
  for (let at = text.indexOf(q); at !== -1 && out.length < 1000; at = text.indexOf(q, at + 1)) {
    const a = map[at];
    const b = map[at + q.length - 1];
    out.push({ start: { chunk: a.c, offset: a.o }, end: { chunk: b.c, offset: b.o + 1 } });
  }
  return out;
}

/** The `occ`-th occurrence (falls back to the first when the message changed), or null. */
export function locateQuote(chunks, quote, occ = 0) {
  const all = locateAll(chunks, quote);
  return all[occ] || all[0] || null;
}

/** Which occurrence starts exactly at this position? Used when a highlight is created from a selection. */
export function occurrenceAt(chunks, quote, chunk, offset) {
  const i = locateAll(chunks, quote).findIndex((r) => r.start.chunk === chunk && r.start.offset === offset);
  return i < 0 ? 0 : i;
}
