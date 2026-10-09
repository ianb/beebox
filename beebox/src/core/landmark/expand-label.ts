/**
 * A plain-words label for an unnamed landmark `expand`, so the place page can
 * show each expand as its own group that says what it lists ("Every loan card
 * here") instead of an unlabeled run of links. The query is a glob relative to
 * the landmark's directory (`resolve/core.ts`, `runQuery`).
 *
 * See docs/implemented-plans/landmark-arrival.md, Track C.
 */

const HERE_RE = /^\*\.([\da-z][\da-z-]*)\.card$/;
const BELOW_RE = /^\*\*\/\*\.([\da-z][\da-z-]*)\.card$/;

/** "Every <type> card here", "… and in folders below", or "Cards matching <query>". */
export function expandLabel(query: string): string {
  const here = HERE_RE.exec(query);
  if (here !== null) return `Every ${here[1]} card here`;
  const below = BELOW_RE.exec(query);
  if (below !== null) return `Every ${below[1]} card here and in folders below`;
  return `Cards matching ${query}`;
}
