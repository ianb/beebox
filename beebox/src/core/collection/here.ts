/**
 * `here` — the place a collection is asked about, and the only thing that
 * gives a query meaning (`docs/plans/todo-collection.md`, Track 3; the parked
 * query-cards verdict is that "a standalone query card is a selection with no
 * *here*").
 *
 * It is `""` (the box), a directory, or one card. Which of the last two is
 * decided by the path's SHAPE — a `.card` basename, the same grammar
 * `shared/card-name.ts` gives the rest of the system — never by a `stat`: a
 * query must resolve the same way whether or not the path exists yet.
 */

import { parseCardFileName } from "../../shared/card-name.js";

/** True when `here` names one card rather than a directory. */
export function hereIsCard(here: string): boolean {
  const base = here.split("/").pop() ?? here;
  return parseCardFileName(base) !== null;
}

/** The scope glob `here` implies: the box, the card itself, or the directory's subtree. */
export function defaultGlobFor(here: string): string {
  if (here === "") return "**/*.card";
  if (hereIsCard(here)) return here;
  return `${here}/**`;
}

/**
 * Whether a resolved ref points INTO `here`: the same path, or — for a
 * directory — anything beneath it. A card path has no subtree, so a ref to
 * its sibling does not match.
 *
 * Nothing is outside the box, so a box-wide `here` matches nothing: there is
 * no card left for a reference to arrive from.
 */
export function refMatchesHere(ref: string, here: string): boolean {
  if (here === "") return false;
  if (ref === here) return true;
  if (hereIsCard(here)) return false;
  return ref.startsWith(`${here}/`);
}
