// Path matching for quick-open. PURE — no filesystem, no git — so it runs in
// the browser over a corpus fetched once, rather than a round trip per
// keystroke.
//
// Duplicated from the server's file-index.ts rather than imported: the frontend
// and server tsconfigs are separate graphs, and the resident-app precedent is to
// share patterns, not source (src/server/exhibits/store.ts:9-12). The behaviour
// is pinned by a doctest on the server copy; if the two ever disagree, that test
// is what says so.

import type { DocumentKind } from "../../shared/documents.js";

export interface IndexedPath {
  relPath: string;
  kind: DocumentKind;
}

/**
 * Subsequence match with a bias toward the basename — the behaviour every
 * quick-open has, and the reason typing `comstore` finds
 * `bin/lib/comments-store.ts`.
 *
 * Returns null when the query does not match at all, so a caller can filter and
 * rank in one pass.
 */
export function scorePath(relPath: string, query: string): number | null {
  if (query === "") return 0;
  const haystack = relPath.toLowerCase();
  const needle = query.toLowerCase();

  // A contiguous hit beats a scattered one, and a hit in the basename beats one
  // in a directory nobody was thinking about.
  const direct = haystack.indexOf(needle);
  if (direct !== -1) {
    const basenameAt = haystack.lastIndexOf("/") + 1;
    return direct >= basenameAt ? 1000 - direct : 500 - direct;
  }

  let position = 0;
  let gaps = 0;
  for (const character of needle) {
    const found = haystack.indexOf(character, position);
    if (found === -1) return null;
    if (found > position) gaps += 1;
    position = found + 1;
  }
  return 100 - gaps;
}

/** The best matches for a query, most relevant first. */
export function searchPaths(
  paths: IndexedPath[],
  query: { text: string; limit: number },
): IndexedPath[] {
  const scored: Array<{ entry: IndexedPath; score: number }> = [];
  for (const entry of paths) {
    const score = scorePath(entry.relPath, query.text);
    if (score !== null) scored.push({ entry, score });
  }
  return scored
    .toSorted((a, b) => b.score - a.score || a.entry.relPath.length - b.entry.relPath.length)
    .slice(0, query.limit)
    .map((match) => match.entry);
}
