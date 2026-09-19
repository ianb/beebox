# Migration: media files move into their card's attach scope

`scripts/migrate/filename-attach-scope.ts` repairs legacy media cards whose
`filename.ref` names a flat file by path instead of `attach/<file>`. It moves
the file into `<card name>.attach/` and rewrites the ref. It repairs a card
only when the file is certain; every other card is reported and left alone.
`classifyFilenameRefs` is the pure decision; `migrateBox` runs it on a box.

```ts setup
import { classifyFilenameRefs, migrateBox } from "../../../scripts/migrate/filename-attach-scope.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

function decide(cards, files) {
  const set = new Set(files);
  return classifyFilenameRefs(cards, (rel) => set.has(rel)).map((d) =>
    d.kind === "repair" ? `${d.cardRel}: repair ${d.fromRel} -> ${d.toRel} (${d.newRef})` : `${d.cardRel}: ${d.reason}`,
  );
}
```

## The rule

The legacy capture layout: a box-absolute ref to a file beside the card. The
card and file names need not match; the card names the file, the file is next
to it, and no other media card claims it. A dotted card name keeps its dot.

```ts
decide(
  [
    { cardRel: "_content/cap/photo-004-Beach.image.card", ref: "/_content/cap/photo-004.jpg" },
    { cardRel: "_content/cap/Mr. Smith.image.card", ref: "IMG_1234.jpg" },
  ],
  ["_content/cap/photo-004.jpg", "_content/cap/IMG_1234.jpg"],
)
=>
[
  "_content/cap/photo-004-Beach.image.card: repair _content/cap/photo-004.jpg -> _content/cap/photo-004-Beach.attach/photo-004.jpg (attach/photo-004.jpg)",
  "_content/cap/Mr. Smith.image.card: repair _content/cap/IMG_1234.jpg -> _content/cap/Mr. Smith.attach/IMG_1234.jpg (attach/IMG_1234.jpg)"
]
```

A dangling ref whose file sits in the card's own directory is repaired too.
This is what an old `bbx mv` of the directory left behind: the file moved and
the absolute ref kept the old directory.

```ts
decide(
  [{ cardRel: "_bookkeeping/archive/cap/clip-1.audio.card", ref: "/_content/cap/clip-1.m4a" }],
  ["_bookkeeping/archive/cap/clip-1.m4a"],
)
=>
[
  "_bookkeeping/archive/cap/clip-1.audio.card: repair _bookkeeping/archive/cap/clip-1.m4a -> _bookkeeping/archive/cap/clip-1.attach/clip-1.m4a (attach/clip-1.m4a)"
]
```

Everything uncertain is reported with a reason: a file in another directory, a
file two cards claim, a file that is nowhere, a ref that is a card, a ref that
escapes the box. A card already in `attach/` form gets no decision at all, so
a second run finds nothing to do; it still counts as a claimant.

```ts
decide(
  [
    { cardRel: "_content/cap/A.image.card", ref: "/_content/shared/a.jpg" },
    { cardRel: "_content/cap/B.image.card", ref: "b.jpg" },
    { cardRel: "_content/cap/C.image.card", ref: "/_content/cap/b.jpg" },
    { cardRel: "_content/cap/D.image.card", ref: "/_content/cap/gone.jpg" },
    { cardRel: "_content/cap/E.file.card", ref: "Other.doc.card" },
    { cardRel: "_content/cap/F.image.card", ref: "../../../outside.jpg" },
    { cardRel: "_content/cap/G.image.card", ref: "attach/g.jpg" },
    { cardRel: "_content/cap/G.attach/H.image.card", ref: "/_content/cap/G.attach/g.jpg" },
  ],
  ["_content/shared/a.jpg", "_content/cap/b.jpg", "_content/cap/Other.doc.card", "_content/cap/G.attach/g.jpg"],
)
=>
[
  "_content/cap/A.image.card: outside-card-dir",
  "_content/cap/B.image.card: shared-with _content/cap/C.image.card",
  "_content/cap/C.image.card: shared-with _content/cap/B.image.card",
  "_content/cap/D.image.card: not-found",
  "_content/cap/E.file.card: target-is-card",
  "_content/cap/F.image.card: escapes-box",
  "_content/cap/G.attach/H.image.card: shared-with _content/cap/G.image.card"
]
```

## Running it on a box

A dry run reports and changes nothing:

```ts
const box = await makeTmpBox();
await box.write("_content/cap/photo-004.jpg", "JPG4");
await box.write(
  "_content/cap/photo-004-Beach.image.card",
  "---\nfilename:\n  ref: /_content/cap/photo-004.jpg\n  captured: 2026-01-02T03:04:05Z\n---\n![beach](/_content/cap/photo-004.jpg)\n",
);
await box.write("_content/notes/trip.doc.card", "---\ntitle: Trip\n---\n![b](../cap/photo-004.jpg) and [b](/_content/cap/photo-004.jpg)\n");
await box.write("_content/cap/gone.image.card", "---\nfilename:\n  ref: /_content/cap/gone.jpg\n---\n");
await box.write("_content/cap/taken.jpg", "NEW");
await box.write("_content/cap/taken.attach/taken.jpg", "OLD");
await box.write("_content/cap/taken.image.card", "---\nfilename:\n  ref: taken.jpg\n---\n");

const dry = await migrateBox(box.root, false);
[dry.repaired.length, dry.ambiguous.length, await box.read("_content/cap/photo-004.jpg")]
=>
[
  2,
  1,
  "JPG4"
]
```

With `--apply`, the file moves, the card's own refs become `attach/`, other
cards follow the move in their own style, and a destination holding different
bytes leaves the card for review:

```ts continue
const report = await migrateBox(box.root, true);
report.ambiguous.map((d) => `${d.cardRel}: ${d.reason}`)
=>
[
  "_content/cap/gone.image.card: not-found",
  "_content/cap/taken.image.card: destination-differs"
]

await box.read("_content/cap/photo-004-Beach.image.card")
=>
---
filename:
  ref: attach/photo-004.jpg
  captured: 2026-01-02T03:04:05Z
---
![beach](attach/photo-004.jpg)

await box.read("_content/cap/photo-004-Beach.attach/photo-004.jpg")
=> JPG4

(await box.read("_content/notes/trip.doc.card")).includes("![b](../cap/photo-004-Beach.attach/photo-004.jpg) and [b](/_content/cap/photo-004-Beach.attach/photo-004.jpg)")
=> true

await box.read("_content/cap/taken.jpg")
=> NEW
```

A second run finds nothing to repair:

```ts continue
(await migrateBox(box.root, true)).repaired.length
=> 0
```

```ts continue
await box.cleanup();
```
