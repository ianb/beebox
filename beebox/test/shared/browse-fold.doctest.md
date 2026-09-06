# `browse-fold.ts` — the Browse compact/raw fold decision

`foldListing(listing)` is the pure fold decision behind compact Browse
(`docs/plans/card-prominence.md`, Track C): what leads a directory's
listing, and what folds behind "N more". Every branch in the module doc.

```ts setup
import { foldListing, type Listing, type FoldEntry } from "../../src/shared/browse-fold.js";

interface Card { name: string; prominence: "entry-point" | "primary" | "background" | "ordinary" }
interface Dir { name: string; summary: { hasEntryPoint: boolean; primaryCount: number; background: boolean }; landmark?: { label: string; symbol: null } | undefined }
interface File { name: string }

function card(name: string, prominence: Card["prominence"]): Card {
  return { name, prominence };
}

function dir(name: string, opts?: { hasEntryPoint?: boolean; primaryCount?: number; background?: boolean; landmark?: { label: string } }): Dir {
  const summary = {
    hasEntryPoint: opts?.hasEntryPoint ?? false,
    primaryCount: opts?.primaryCount ?? 0,
    background: opts?.background ?? false,
  };
  return opts?.landmark
    ? { name, summary, landmark: { label: opts.landmark.label, symbol: null } }
    : { name, summary };
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
```

## Nothing prominent anywhere: identical to raw, no fold

No entry-point or primary card, no subdirectory carrying anything
prominent: `folded` is false and `more` is today's order — dirs, then
cards, then files, each natural-sorted.

```ts
const plain = listing({
  cards: [card("Zeta", "ordinary"), card("Alpha", "ordinary")],
  dirs: [dir("sub")],
  files: [file("notes.txt")],
});
const result = foldListing(plain);
`${result.folded} ${fmtAll(result.lead)} | ${fmtAll(result.more)}`
=> false  | dir:sub card:Alpha card:Zeta file:notes.txt
```

An empty listing folds the same way — nothing to lead with, no disclosure.

```ts
foldListing(listing({})).folded
=> false
```

## Entry-point and primary cards lead, ordinary and background follow

```ts
const mixed = listing({
  cards: [
    card("Ordinary1", "ordinary"),
    card("Entry", "entry-point"),
    card("Log", "background"),
    card("Primary1", "primary"),
  ],
});
const mixedResult = foldListing(mixed);
`${mixedResult.folded} | ${fmtAll(mixedResult.lead)} | ${fmtAll(mixedResult.more)}`
=> true | card:Entry card:Primary1 | card:Ordinary1 card:Log*
```

## Subdirectories: prominent ones lead (with landmark identity), others fold

A subdirectory whose summary has an entry point or a primary joins `lead`;
one with neither, but with a marked card elsewhere forcing a fold, lands in
`more` unmarked. A subdirectory's own landmark identity travels with it.

```ts
const dirs = listing({
  cards: [card("Entry", "entry-point")],
  dirs: [
    dir("Recipes", { primaryCount: 2, landmark: { label: "Recipes" } }),
    dir("Logs", { background: true }),
    dir("Notes"),
  ],
});
const dirsResult = foldListing(dirs);
`${fmtAll(dirsResult.lead)} | ${fmtAll(dirsResult.more)}`
=> card:Entry dir:Recipes | dir:Notes dir:Logs*

dirsResult.lead.find((e) => e.kind === "dir" && e.dir.name === "Recipes")?.kind === "dir"
  ? (dirsResult.lead.find((e) => e.kind === "dir") as { dir: Dir }).dir.landmark?.label
  : null
=> Recipes
```

## A background directory folds everything into `more`, dimmed

The listing's own directory is background (its landmark, or a cascaded
ancestor's) — every item folds into `more`, dimmed, regardless of its own
level, and `folded` is true.

```ts
const bg = listing({
  background: true,
  cards: [card("Entry", "entry-point"), card("Plain", "ordinary")],
  dirs: [dir("sub", { primaryCount: 1 })],
  files: [file("notes.txt")],
});
const bgResult = foldListing(bg);
`${bgResult.folded} | ${fmtAll(bgResult.lead)} | ${fmtAll(bgResult.more)}`
=> true |  | dir:sub* card:Entry* card:Plain* file:notes.txt*
```

## Sorting is natural order within every tier

```ts
const nat = listing({
  cards: [card("Item-10", "primary"), card("Item-2", "primary"), card("Item-1", "primary")],
});
fmtAll(foldListing(nat).lead)
=> card:Item-1 card:Item-2 card:Item-10
```
