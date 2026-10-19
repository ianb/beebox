// # `browse-fold.ts` — the Browse compact/raw fold decision
//
// `foldListing(listing)` is the pure fold decision behind compact Browse
// (`docs/implemented-plans/card-prominence.md`, Track C): what leads a directory's
// listing, and what folds behind "N more". Every branch in the module doc.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { foldListing, type Listing, type FoldEntry } from "../../src/shared/browse-fold.js";

interface Card { name: string; prominence: "entry-point" | "primary" | "background" | "ordinary" }
interface Dir { name: string; summary: { hasEntryPoint: boolean; primaryCount: number; background: boolean; cardCount: number | null }; landmark?: { label: string; symbol: null } | undefined; seeded: boolean }
interface File { name: string }

function card(name: string, prominence: Card["prominence"]): Card {
  return { name, prominence };
}

function dir(name: string, opts?: { hasEntryPoint?: boolean; primaryCount?: number; background?: boolean; landmark?: { label: string }; seeded?: boolean; cardCount?: number | null }): Dir {
  const summary = {
    hasEntryPoint: opts?.hasEntryPoint ?? false,
    primaryCount: opts?.primaryCount ?? 0,
    background: opts?.background ?? false,
    cardCount: opts?.cardCount === undefined ? 1 : opts.cardCount,
  };
  const seeded = opts?.seeded ?? false;
  return opts?.landmark
    ? { name, summary, landmark: { label: opts.landmark.label, symbol: null }, seeded }
    : { name, summary, seeded };
}

/** A box-layout template folder with nothing below it. */
function seededEmpty(name: string): Dir {
  return dir(name, { seeded: true, cardCount: 0 });
}

function file(name: string): File {
  return { name };
}

function listing(opts: { background?: boolean; cards?: Card[]; dirs?: Dir[]; files?: File[] }): Listing<Card, Dir, File> {
  return {
    background: opts.background ?? false,
    cards: opts.cards ?? [],
    dirs: opts.dirs ?? [],
    files: opts.files ?? [],
  };
}

/** Compact rendering of a fold entry: kind, name, dimmed flag. */
function fmt(entry: FoldEntry<Card, Dir, File>): string {
  const dim = entry.dimmed ? "*" : "";
  if (entry.kind === "card") return `card:${entry.card.name}${dim}`;
  if (entry.kind === "dir") return `dir:${entry.dir.name}${dim}`;
  return `file:${entry.file.name}${dim}`;
}

function fmtAll(entries: FoldEntry<Card, Dir, File>[]): string {
  return entries.map(fmt).join(" ");
}

// ## Nothing prominent anywhere: identical to raw, no fold
//
// No entry-point or primary card, no subdirectory carrying anything
// prominent: `folded` is false and `more` is today's order — dirs, then
// cards, then files, each natural-sorted.
void test("No entry-point or primary card, no subdirectory carrying anything prominent:", async (t) => {
  const plain = listing({
    cards: [card("Zeta", "ordinary"), card("Alpha", "ordinary")],
    dirs: [dir("sub")],
    files: [file("notes.txt")],
  });
  const result = foldListing(plain);
  t.check(`${result.folded} ${fmtAll(result.lead)} | ${fmtAll(result.more)}`, "false  | dir:sub card:Alpha card:Zeta file:notes.txt");
});

// An empty listing folds the same way — nothing to lead with, no disclosure.
void test("An empty listing folds the same way — nothing to lead with, no disclosure.", async (t) => {
  t.check(foldListing(listing({})).folded, false);
});

// ## Entry-point and primary cards lead, ordinary and background follow
void test("Entry-point and primary cards lead, ordinary and background follow", async (t) => {
  const mixed = listing({
    cards: [
      card("Ordinary1", "ordinary"),
      card("Entry", "entry-point"),
      card("Log", "background"),
      card("Primary1", "primary"),
    ],
  });
  const mixedResult = foldListing(mixed);
  t.check(`${mixedResult.folded} | ${fmtAll(mixedResult.lead)} | ${fmtAll(mixedResult.more)}`, "true | card:Entry card:Primary1 | card:Ordinary1 card:Log*");
});

// ## Subdirectories: prominent ones lead (with landmark identity), others fold
//
// A subdirectory whose summary has an entry point or a primary joins `lead`;
// one with neither, but with a marked card elsewhere forcing a fold, lands in
// `more` unmarked. A subdirectory's own landmark identity travels with it.
void test("A subdirectory whose summary has an entry point or a primary joins lead; one...", async (t) => {
  const dirs = listing({
    cards: [card("Entry", "entry-point")],
    dirs: [
      dir("Recipes", { primaryCount: 2, landmark: { label: "Recipes" } }),
      dir("Logs", { background: true }),
      dir("Notes"),
    ],
  });
  const dirsResult = foldListing(dirs);
  t.check(`${fmtAll(dirsResult.lead)} | ${fmtAll(dirsResult.more)}`, "card:Entry dir:Recipes | dir:Notes dir:Logs*");

  const leadDirs = dirsResult.lead.flatMap((e) => (e.kind === "dir" ? [e.dir] : []));
  t.check(leadDirs[0]?.landmark?.label, "Recipes");
});

// ## A background directory folds everything into `more`, dimmed
//
// The listing's own directory is background (its landmark, or a cascaded
// ancestor's) — every item folds into `more`, dimmed, regardless of its own
// level, and `folded` is true.
void test("The listing's own directory is background (its landmark, or a cascaded ancest...", async (t) => {
  const bg = listing({
    background: true,
    cards: [card("Entry", "entry-point"), card("Plain", "ordinary")],
    dirs: [dir("sub", { primaryCount: 1 })],
    files: [file("notes.txt")],
  });
  const bgResult = foldListing(bg);
  t.check(`${bgResult.folded} | ${fmtAll(bgResult.lead)} | ${fmtAll(bgResult.more)}`, "true |  | dir:sub* card:Entry* card:Plain* file:notes.txt*");
});

// ## Sorting is natural order within every tier
void test("Sorting is natural order within every tier", async (t) => {
  const nat = listing({
    cards: [card("Item-10", "primary"), card("Item-2", "primary"), card("Item-1", "primary")],
  });
  t.check(fmtAll(foldListing(nat).lead), "card:Item-1 card:Item-2 card:Item-10");
});

// ## Seeded empty folders fold behind "N more"
//
// `docs/plans/front-door.md`, Track D. A new box's `_content` holds the box
// layout's template folders, all empty, and the person's first cards. The
// cards lead in today's order; the empty template folders fold, not dimmed.
const TEMPLATE_FOLDERS = ["inbox", "incoming", "recipes", "todos", "drive", "calendar", "chat", "reviews", "people", "places"];

void test("A new box's content listing leads with its cards and folds the empty template folders", async (t) => {
  const fresh = listing({
    cards: [card("Welcome", "ordinary"), card("Notes", "ordinary")],
    dirs: TEMPLATE_FOLDERS.map(seededEmpty),
  });
  const result = foldListing(fresh);
  t.check(`${result.folded} | ${fmtAll(result.lead)} | ${fmtAll(result.more)}`,
    "true | card:Notes card:Welcome | dir:calendar dir:chat dir:drive dir:inbox dir:incoming dir:people dir:places dir:recipes dir:reviews dir:todos");
});

// With something prominent, seeded empty folders come after the plain
// folders and before the dimmed background tiers.
void test("With something prominent, seeded empty folders follow plain folders, not dimmed", async (t) => {
  const result = foldListing(listing({
    cards: [card("Entry", "entry-point"), card("Log", "background")],
    dirs: [seededEmpty("drive"), dir("projects"), dir("Logs", { background: true })],
  }));
  t.check(`${fmtAll(result.lead)} | ${fmtAll(result.more)}`, "card:Entry | dir:projects dir:drive card:Log* dir:Logs*");
});

// A seeded folder with a card below it stays where it is today; so do a
// person's own empty `taxes/`, a seeded folder whose count failed, and a
// seeded folder that carries its own landmark. None of these fold.
void test("A seeded folder with a card below, a person's empty folder, a failed count, and a landmark do not fold", async (t) => {
  const result = foldListing(listing({
    cards: [card("Notes", "ordinary")],
    dirs: [
      dir("recipes", { seeded: true, cardCount: 1 }),
      dir("taxes", { cardCount: 0 }),
      dir("drive", { seeded: true, cardCount: null }),
      dir("people", { seeded: true, cardCount: 0, landmark: { label: "People" } }),
    ],
  }));
  t.check(`${result.folded} | ${fmtAll(result.lead)} | ${fmtAll(result.more)}`, "false |  | dir:drive dir:people dir:recipes dir:taxes card:Notes");
});

// The box root listing (the five areas) is unchanged: areas are never seeded.
void test("The box root listing is unchanged", async (t) => {
  const root = listing({ dirs: ["_tmp", "_content", "_config", "_publish", "_bookkeeping"].map((name) => dir(name, { cardCount: 0 })) });
  const result = foldListing(root);
  t.check(`${result.folded} | ${fmtAll(result.lead)} | ${fmtAll(result.more)}`, "false |  | dir:_bookkeeping dir:_config dir:_content dir:_publish dir:_tmp");
});
