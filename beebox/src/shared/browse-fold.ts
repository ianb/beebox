/**
 * The Browse fold decision — `docs/implemented-plans/card-prominence.md`, Track C.
 *
 * Pure function over a plain listing shape: given a directory's cards
 * (carrying an effective `prominence`), plain files, and subdirectories
 * (carrying a `DirectorySummary`-like rollup and optional landmark
 * identity), decide what leads the listing and what folds behind the "N
 * more" disclosure. Reached by a doctest, never through the page
 * (`docs/engineering-principles.md` #10).
 *
 * - **lead**: entry-point cards, then primary cards, then subdirectories
 *   whose summary has an entry point or a primary (carrying their landmark
 *   identity when they have one).
 * - **more**: ordinary cards, then plain files, then subdirectories with
 *   nothing prominent, then background cards, then background directories
 *   — the last two dimmed.
 * - A listing with nothing prominent anywhere (no lead candidates, and the
 *   listing's own directory isn't itself background) returns `lead: []`
 *   and `more` in TODAY'S order — dirs, then cards, then files, each
 *   natural-sorted — with `folded: false`: the page renders exactly as it
 *   does today, no disclosure.
 * - A `background` directory (its own landmark, or a cascaded ancestor's)
 *   folds EVERYTHING into `more`, every item dimmed, `folded: true` — the
 *   whole directory is housekeeping, so even an otherwise-ordinary card
 *   inside it is presented as such.
 *
 * Sorting inside every tier is `naturalCompare` by name, matching today's
 * Browse sort.
 */

import { naturalCompare } from "../lib/natural-sort.js";
import type { EffectiveLevel } from "./prominence.js";
import type { CardSymbolData } from "./card-symbol.js";

export interface ListingCard {
  name: string;
  prominence: EffectiveLevel;
}

export interface ListingDirSummary {
  hasEntryPoint: boolean;
  primaryCount: number;
  background: boolean;
}

export interface ListingDirLandmark {
  label: string;
  symbol: CardSymbolData | null;
}

export interface ListingDir {
  name: string;
  summary: ListingDirSummary;
  /** The subdirectory's own landmark identity, when it has one. */
  landmark?: ListingDirLandmark | undefined;
}

export interface ListingFile {
  name: string;
}

export interface Listing<
  Card extends ListingCard = ListingCard,
  Dir extends ListingDir = ListingDir,
  File extends ListingFile = ListingFile,
> {
  /** Whether the LISTED directory itself is background (own landmark, or a cascaded ancestor's). */
  background: boolean;
  cards: Card[];
  dirs: Dir[];
  files: File[];
}

export type FoldEntry<
  Card extends ListingCard = ListingCard,
  Dir extends ListingDir = ListingDir,
  File extends ListingFile = ListingFile,
> =
  | { kind: "card"; card: Card; dimmed: boolean }
  | { kind: "dir"; dir: Dir; dimmed: boolean }
  | { kind: "file"; file: File; dimmed: boolean };

export interface FoldResult<
  Card extends ListingCard = ListingCard,
  Dir extends ListingDir = ListingDir,
  File extends ListingFile = ListingFile,
> {
  /** False means: render `more` exactly as today, no disclosure. */
  folded: boolean;
  lead: FoldEntry<Card, Dir, File>[];
  more: FoldEntry<Card, Dir, File>[];
}

function byName(a: { name: string }, b: { name: string }): number {
  return naturalCompare(a.name, b.name);
}

function dirHasSomethingProminent(summary: ListingDirSummary): boolean {
  return summary.hasEntryPoint || summary.primaryCount > 0;
}

/**
 * The raw, unsorted-tier listing — today's Browse order: dirs, then cards,
 * then files, each natural-sorted, nothing dimmed, nothing folded.
 */
function rawOrder<Card extends ListingCard, Dir extends ListingDir, File extends ListingFile>(
  listing: Listing<Card, Dir, File>,
): FoldEntry<Card, Dir, File>[] {
  const dirs = listing.dirs.toSorted(byName).map((dir): FoldEntry<Card, Dir, File> => ({ kind: "dir", dir, dimmed: false }));
  const cards = listing.cards.toSorted(byName).map((card): FoldEntry<Card, Dir, File> => ({ kind: "card", card, dimmed: false }));
  const files = listing.files.toSorted(byName).map((file): FoldEntry<Card, Dir, File> => ({ kind: "file", file, dimmed: false }));
  return [...dirs, ...cards, ...files];
}

/** Every item, dimmed, in the same relative grouping `rawOrder` uses — for a directory that is itself background. */
function allDimmed<Card extends ListingCard, Dir extends ListingDir, File extends ListingFile>(
  listing: Listing<Card, Dir, File>,
): FoldEntry<Card, Dir, File>[] {
  return rawOrder(listing).map((entry) => ({ ...entry, dimmed: true }));
}

/**
 * Decide `{ lead, more }` for a directory's listing. See the module doc for
 * the full rules.
 */
export function foldListing<
  Card extends ListingCard = ListingCard,
  Dir extends ListingDir = ListingDir,
  File extends ListingFile = ListingFile,
>(listing: Listing<Card, Dir, File>): FoldResult<Card, Dir, File> {
  if (listing.background) {
    return { folded: true, lead: [], more: allDimmed(listing) };
  }

  const entryPointCards = listing.cards.filter((c) => c.prominence === "entry-point").toSorted(byName);
  const primaryCards = listing.cards.filter((c) => c.prominence === "primary").toSorted(byName);
  const ordinaryCards = listing.cards.filter((c) => c.prominence === "ordinary").toSorted(byName);
  const backgroundCards = listing.cards.filter((c) => c.prominence === "background").toSorted(byName);

  const prominentDirs = listing.dirs.filter((d) => !d.summary.background && dirHasSomethingProminent(d.summary)).toSorted(byName);
  const plainDirs = listing.dirs.filter((d) => !d.summary.background && !dirHasSomethingProminent(d.summary)).toSorted(byName);
  const backgroundDirs = listing.dirs.filter((d) => d.summary.background).toSorted(byName);

  const nothingProminent = entryPointCards.length === 0 && primaryCards.length === 0 && prominentDirs.length === 0;
  if (nothingProminent) {
    return { folded: false, lead: [], more: rawOrder(listing) };
  }

  const lead: FoldEntry<Card, Dir, File>[] = [
    ...entryPointCards.map((card): FoldEntry<Card, Dir, File> => ({ kind: "card", card, dimmed: false })),
    ...primaryCards.map((card): FoldEntry<Card, Dir, File> => ({ kind: "card", card, dimmed: false })),
    ...prominentDirs.map((dir): FoldEntry<Card, Dir, File> => ({ kind: "dir", dir, dimmed: false })),
  ];

  const files = listing.files.toSorted(byName);
  const more: FoldEntry<Card, Dir, File>[] = [
    ...ordinaryCards.map((card): FoldEntry<Card, Dir, File> => ({ kind: "card", card, dimmed: false })),
    ...files.map((file): FoldEntry<Card, Dir, File> => ({ kind: "file", file, dimmed: false })),
    ...plainDirs.map((dir): FoldEntry<Card, Dir, File> => ({ kind: "dir", dir, dimmed: false })),
    ...backgroundCards.map((card): FoldEntry<Card, Dir, File> => ({ kind: "card", card, dimmed: true })),
    ...backgroundDirs.map((dir): FoldEntry<Card, Dir, File> => ({ kind: "dir", dir, dimmed: true })),
  ];

  return { folded: true, lead, more };
}
