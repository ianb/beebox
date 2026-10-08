/**
 * The app bar's published places, as a stack of owner-tagged entries
 * (`app-bar-chrome.tsx`). The newest publication shows. When its owner
 * clears it, the bar falls back to the entry below it rather than to the
 * route label: a focused Browse card publishes over the chat's place, and
 * closing Browse must give the chat's place back. The chat's effect does not
 * re-run on that close, so only the stack can restore it.
 */

import type { AppBarPlace } from "../components/app-bar-chrome";

export interface PlaceEntry {
  owner: object;
  place: AppBarPlace;
}

/** Publish or republish: the owner's entry moves to the top, so the latest publication wins. */
export function pushPlace(stack: readonly PlaceEntry[], entry: PlaceEntry): PlaceEntry[] {
  return [...stack.filter((e) => e.owner !== entry.owner), entry];
}

/** Remove only this owner's entry; another owner's entry is untouched. */
export function dropPlace(stack: readonly PlaceEntry[], owner: object): readonly PlaceEntry[] {
  return stack.some((e) => e.owner === owner) ? stack.filter((e) => e.owner !== owner) : stack;
}

/** The place the bar shows: the top entry, or null when nothing is published. */
export function topPlace(stack: readonly PlaceEntry[]): AppBarPlace | null {
  return stack.at(-1)?.place ?? null;
}
