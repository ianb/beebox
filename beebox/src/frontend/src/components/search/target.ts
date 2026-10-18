/**
 * Where a search result opens. One builder for the Search card and Cmd-K.
 *
 * A section result opens its card at the section: the target's `fragment` is
 * the hit's section path, which the file view resolves against the body it
 * renders (`lib/fragment-target.ts`). A gdoc's sections are indexed from its
 * synced attachment, not from the card, so a gdoc result has no section
 * destination and does not promise one.
 */

import type { ViewTarget } from "../../lib/view-url";

/** The part of a search hit this needs (`SearchResult`, from the tRPC output). */
export interface SearchHitPlace {
  path: string;
  kind: string;
  /** Section path (`/Plan/Status`), or "" for the card's own document. */
  fragment: string;
}

/** Kinds whose indexed sections are not in the card the result opens. */
const SECTIONS_ELSEWHERE = new Set(["gdoc"]);

/** The section this result opens at, or null when it opens the card at its top. */
export function sectionDestination(hit: SearchHitPlace): string | null {
  return hit.fragment === "" || SECTIONS_ELSEWHERE.has(hit.kind) ? null : hit.fragment;
}

export function searchResultTarget(hit: SearchHitPlace): ViewTarget {
  const target: ViewTarget = { path: hit.path, viewer: null, params: {}, viewState: null };
  const fragment = sectionDestination(hit);
  return fragment === null ? target : { ...target, fragment };
}
