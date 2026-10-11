/**
 * "Also here": the place page's last group, listing the place's ordinary cards
 * that no tier or other group already shows, most recently changed first
 * (docs/implemented-plans/place-shows-cards.md, Track A). The server builds it from the
 * pruned walk's `ordinary` list (`landmarks/payload.ts`) and marks it
 * `alsoHere: true`, which the place page reads to open the folder in Browse
 * from its overflow count.
 */

import { naturalCompare } from "./natural-sort.js";

export const ALSO_HERE_LABEL = "Also here";

/** Cards the group lists before its overflow count. */
export const ALSO_HERE_CAP = 10;

interface OrdinaryCard {
  /** Box-relative path, leading "/". */
  boxPath: string;
  mtimeMs: number;
}

export interface AlsoHereSelection<T extends OrdinaryCard> {
  /** The first `cap` cards, most recently changed first; the path breaks ties. */
  cards: T[];
  /** Every ordinary card not already shown, before the cap. */
  count: number;
}

/**
 * Pick the "Also here" cards: `ordinary` minus any card in `shownRefs`
 * (box-relative refs without the leading "/", as `ResolvedLink.ref` carries
 * them, query and fragment removed), sorted by `mtimeMs` descending with a
 * natural path order for equal mtimes, then capped at `cap`.
 */
export function alsoHere<T extends OrdinaryCard>(
  ordinary: readonly T[],
  { shownRefs, cap }: { shownRefs: ReadonlySet<string>; cap: number },
): AlsoHereSelection<T> {
  const remaining = ordinary
    .filter((card) => !shownRefs.has(card.boxPath.slice(1)))
    .toSorted((a, b) => b.mtimeMs - a.mtimeMs || naturalCompare(a.boxPath, b.boxPath));
  return { cards: remaining.slice(0, cap), count: remaining.length };
}
