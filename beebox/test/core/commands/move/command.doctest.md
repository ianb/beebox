# `bbx mv` — move/rename cards and rewrite references

The move command relocates a card (or directory) and keeps every reference
pointing at the new location. References live in many places — frontmatter
`ref:`/`refs:`, body Markdoc tags (`{% source ref="…" %}`), inline markdown
links and images (`[text](path)`, `![alt](path)`), and XML body `ref=`
attributes — and may be written box-root-absolute (`/_content/box/…`) or relative to
the referencing card. All of them follow the move, in whichever style they
were written. A card's sibling `<basename>.attach/` directory moves with it,
and references that point *into* that attach directory from other cards are
rewritten too.

```ts setup
import { executeMove } from "../../../../src/core/commands/move/command.js";
import { extractBodyLinks } from "../../../../src/core/body-refs.js";
import { createCollectorContext } from "../../../../src/core/command-runner.js";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";

async function mv(box, args) {
  const { ctx } = createCollectorContext(box.root);
  return executeMove(ctx, args);
}

/** Build a throwaway box from a path -> content map and pass it to `fn`. */
async function withBox(files, fn) {
  const box = await makeTmpBox();
  try {
    for (const [file, content] of Object.entries(files)) await box.write(file, content);
    return await fn(box);
  } finally {
    await box.cleanup();
  }
}

/**
 * Move on a box built from `files`, then report as text: `success` or
 * `error: <message>`, followed by each of `paths` -- a path ending in `/` is listed
 * (`>> ls <dir>`), any other path is read (`>> <path>` and its contents).
 */
async function moved(files, args, paths) {
  return withBox(files, async (box) => {
    const result = await mv(box, args);
    const out = [result.success ? "success" : `error: ${result.error}`];
    for (const p of paths ?? []) {
      if (p.endsWith("/")) out.push(`>> ls ${p.slice(0, -1)}`, await box.list(p.slice(0, -1)));
      else out.push(`>> ${p}`, (await box.read(p)).trimEnd());
    }
    return out.join("\n");
  });
}

/** The `success`/`error` of a move that is expected to be rejected. */
const rejected = (files, args) => withBox(files, async (box) => {
  const { success, error } = await mv(box, args);
  return { success, error };
});

/** Fixture files for an index card holding `body` (frontmatter: type doc, title Index). */
const indexCard = (body) => `---\ntype: doc\ntitle: Index\n---\n${body}\n`;
```

## Phase-2 card: file + attach dir move, inbound refs rewritten (relative + absolute, into attachments too)

Moving a frontmatter card carries its `.attach/` directory along. Other cards
that link to the card — or *into* its attach directory — are rewritten whether
they used a relative or a box-root-absolute path. The moved card's own relative
links to cards that stayed put are rewritten too, while its `attach/`-prefixed
self references (scoped to the card) are left untouched.

The card file and its attach directory now live under `_bookkeeping/archive/`.
The moved card keeps its `attach/` self-ref and gets a recomputed relative link
to the card that stayed behind. The sibling card's relative links — to the card
and into its attach dir — are recomputed from its own location. The absolute
links stay absolute, repointed at the new location.

```ts
await moved(
  {
    "_content/box/notes/Engine.doc.card":
      "---\ntype: doc\ntitle: Engine\n---\n# Engine\nPhoto: ![p](attach/photo.jpg)\nRelated: [Priya](Priya.doc.card)\n",
    "_content/box/notes/Engine.attach/photo.jpg": "JPG",
    "_content/box/notes/Priya.doc.card":
      "---\ntype: doc\ntitle: Priya\n---\nSee [Engine](Engine.doc.card) and its [photo](Engine.attach/photo.jpg).\n",
    "_content/box/index.doc.card":
      "---\ntype: doc\ntitle: Index\n---\nAbs [Engine](/_content/box/notes/Engine.doc.card) and [photo](/_content/box/notes/Engine.attach/photo.jpg).\n",
  },
  { from: "_content/box/notes/Engine.doc.card", to: "_bookkeeping/archive/Engine.doc.card" },
  [
    "_bookkeeping/archive/",
    "_bookkeeping/archive/Engine.attach/photo.jpg",
    "_bookkeeping/archive/Engine.doc.card",
    "_content/box/notes/Priya.doc.card",
    "_content/box/index.doc.card",
  ],
)
=>
success
>> ls _bookkeeping/archive
_bookkeeping/archive/Engine.attach
_bookkeeping/archive/Engine.attach/photo.jpg
_bookkeeping/archive/Engine.doc.card
_bookkeeping/archive/done
_bookkeeping/archive/done/.gitkeep
_bookkeeping/archive/failed
_bookkeeping/archive/failed/.gitkeep
_bookkeeping/archive/processed
_bookkeeping/archive/processed/.gitkeep
>> _bookkeeping/archive/Engine.attach/photo.jpg
JPG
>> _bookkeeping/archive/Engine.doc.card
---
type: doc
title: Engine
---
# Engine
Photo: ![p](attach/photo.jpg)
Related: [Priya](../../_content/box/notes/Priya.doc.card)
>> _content/box/notes/Priya.doc.card
---
type: doc
title: Priya
---
See [Engine](../../../_bookkeeping/archive/Engine.doc.card) and its [photo](../../../_bookkeeping/archive/Engine.attach/photo.jpg).
>> _content/box/index.doc.card
---
type: doc
title: Index
---
Abs [Engine](/_bookkeeping/archive/Engine.doc.card) and [photo](/_bookkeeping/archive/Engine.attach/photo.jpg).
```

## Box-local card type: classified by frontmatter shape, not the built-in registry

A box can define its own frontmatter card types (e.g. `bill`) under
`_config/schemas/`. Those types aren't in beebox's built-in schema list,
so a move must recognize them by file *shape* — a `.card` with a frontmatter
block — not by matching a built-in type. (Earlier the type-based check sent any
non-built-in type to the cardworks XML loader, which can't parse frontmatter, so
`bbx mv` on a migrated box-local card failed.) Here a `bill` card with an attach
dir and an inbound ref moves cleanly: the card and its attach directory moved,
and the inbound absolute ref was repointed.

```ts
await moved(
  {
    "_content/box/bills/Water.bill.card": "---\nstatus: due\nvendor: City Water\namount: 42.5\n---\nScan: ![s](attach/scan.pdf)\n",
    "_content/box/bills/Water.attach/scan.pdf": "PDF",
    "_content/box/index.doc.card": indexCard("Unpaid: [Water](/_content/box/bills/Water.bill.card)."),
  },
  { from: "_content/box/bills/Water.bill.card", to: "_bookkeeping/archive/Water.bill.card" },
  ["_bookkeeping/archive/", "_content/box/index.doc.card"],
)
=>
success
>> ls _bookkeeping/archive
_bookkeeping/archive/Water.attach
_bookkeeping/archive/Water.attach/scan.pdf
_bookkeeping/archive/Water.bill.card
_bookkeeping/archive/done
_bookkeeping/archive/done/.gitkeep
_bookkeeping/archive/failed
_bookkeeping/archive/failed/.gitkeep
_bookkeeping/archive/processed
_bookkeeping/archive/processed/.gitkeep
>> _content/box/index.doc.card
---
type: doc
title: Index
---
Unpaid: [Water](/_bookkeeping/archive/Water.bill.card).
```

## Every reference syntax follows the move, in the style it was written

Refs carried by Markdoc body tags, the singular `ref:` scalar and `refs:` list
entries, a `ref:` nested under another key (a landmark destination's
`procedure:\n  ref: …`, always stored under a key named exactly `ref`), and
`ref` as the first key of a block-list item (`messages:`/`items:` lists) all
follow the move, each keeping its own relative or box-root-absolute style.

```ts
await moved(
  {
    "_content/box/people/dana.person.card": "---\ntype: person\nname: Dana\n---\n",
    "_content/box/notes/Mtg.doc.card":
      '---\ntype: doc\ntitle: Mtg\n---\n' +
      'Abs: {% source ref="/_content/box/people/dana.person.card" usage="x" %}a{% /source %}\n' +
      'Rel: {% source ref="../people/dana.person.card" usage="y" %}b{% /source %}\n',
  },
  { from: "_content/box/people/dana.person.card", to: "_content/store/people/dana.person.card" },
  ["_content/box/notes/Mtg.doc.card"],
)
=>
success
>> _content/box/notes/Mtg.doc.card
---
type: doc
title: Mtg
---
Abs: {% source ref="/_content/store/people/dana.person.card" usage="x" %}a{% /source %}
Rel: {% source ref="../../store/people/dana.person.card" usage="y" %}b{% /source %}
```

```ts
await moved(
  {
    "_content/box/a/Target.doc.card": "---\ntype: doc\ntitle: Target\n---\nbody\n",
    "_content/box/a/Ref.memo.card":
      "---\ntype: memo\nref: /_content/box/a/Target.doc.card\nrefs:\n  - Target.doc.card\n  - /_content/box/a/Target.doc.card\n---\nbody\n",
  },
  { from: "_content/box/a/Target.doc.card", to: "_content/box/b/Target.doc.card" },
  ["_content/box/a/Ref.memo.card"],
)
=>
success
>> _content/box/a/Ref.memo.card
---
type: memo
ref: /_content/box/b/Target.doc.card
refs:
  - ../b/Target.doc.card
  - /_content/box/b/Target.doc.card
---
body
```

```ts
await moved(
  {
    "_content/recipes/archive.procedure.card": "---\nsteps: []\n---\nbody\n",
    "_content/recipes/Recipes.landmark.card":
      "---\ndestinations:\n  - for: [triage]\n    procedure:\n      ref: archive.procedure.card\n---\n",
  },
  { from: "_content/recipes/archive.procedure.card", to: "_content/store/handlers/archive.procedure.card" },
  ["_content/recipes/Recipes.landmark.card"],
)
=>
success
>> _content/recipes/Recipes.landmark.card
---
destinations:
  - for: [triage]
    procedure:
      ref: ../store/handlers/archive.procedure.card
---
```

```ts
await moved(
  {
    "_content/store/notes/Plan.doc.card": "---\ntype: doc\ntitle: Plan\n---\nbody\n",
    "_content/store/notes/Index.memo.card":
      "---\ntype: memo\nitems:\n  - ref: Plan.doc.card\n    note: rel\n  - ref: /_content/store/notes/Plan.doc.card\n---\nbody\n",
  },
  { from: "_content/store/notes/Plan.doc.card", to: "_bookkeeping/archive/Plan.doc.card" },
  ["_content/store/notes/Index.memo.card"],
)
=>
success
>> _content/store/notes/Index.memo.card
---
type: memo
items:
  - ref: ../../../_bookkeeping/archive/Plan.doc.card
    note: rel
  - ref: /_bookkeeping/archive/Plan.doc.card
---
body
```

## `?query` and `#fragment` survive the rewrite

A ref may address a location *within* its target — `?view=ledger` picks a view,
`#risks` an anchor. Resolution runs on the path part only (so the ref still
matches the moving card), and the suffix is re-appended to the rewritten ref in
whichever style it was written.

```ts
await moved(
  {
    "_content/store/charts/Ledger.doc.card": "---\ntype: doc\ntitle: Ledger\n---\nx\n",
    "_content/store/Index.doc.card": indexCard(
      "rel [view](charts/Ledger.doc.card?view=ledger) abs [anchor](/_content/store/charts/Ledger.doc.card#risks)\n" +
      "both [x](charts/Ledger.doc.card?view=ledger#risks)",
    ),
  },
  { from: "_content/store/charts/Ledger.doc.card", to: "_bookkeeping/archive/Ledger.doc.card" },
  ["_content/store/Index.doc.card"],
)
=>
success
>> _content/store/Index.doc.card
---
type: doc
title: Index
---
rel [view](../../_bookkeeping/archive/Ledger.doc.card?view=ledger) abs [anchor](/_bookkeeping/archive/Ledger.doc.card#risks)
both [x](../../_bookkeeping/archive/Ledger.doc.card?view=ledger#risks)
```

## Directory move: recursive, external refs rewritten (relative + absolute)

Moving a directory carries everything under it. References from outside the
directory — to anything inside it — are rewritten in either style.

```ts
await moved(
  {
    "_content/box/session/scan.capture-session.card": "<capture-session>\n<note>s</note>\n</capture-session>\n",
    "_content/box/session/photo.image.card": "---\ntype: image\n---\n",
    "_content/box/notes/other.doc.card":
      "---\ntype: doc\n---\nAbs [scan](/_content/box/session/scan.capture-session.card) rel [scan2](../session/scan.capture-session.card)\n",
  },
  { from: "_content/box/session", to: "_bookkeeping/archive/session" },
  ["_bookkeeping/archive/session/", "_content/box/notes/other.doc.card"],
)
=>
success
>> ls _bookkeeping/archive/session
_bookkeeping/archive/session/photo.image.card
_bookkeeping/archive/session/scan.capture-session.card
>> _content/box/notes/other.doc.card
---
type: doc
---
Abs [scan](/_bookkeeping/archive/session/scan.capture-session.card) rel [scan2](../../../_bookkeeping/archive/session/scan.capture-session.card)
```

A card *inside* the moved directory that links *out* of it (by a relative
path) has that link recomputed from its new location; links to siblings that
moved with it are unchanged.

```ts
await moved(
  {
    "_content/box/people/dana.person.card": "---\ntype: person\nname: Dana\n---\n",
    "_content/box/session/scan.capture-session.card": "<capture-session>\n<note>s</note>\n</capture-session>\n",
    "_content/box/session/note.doc.card":
      "---\ntype: doc\n---\nBy [Dana](../people/dana.person.card), see [scan](scan.capture-session.card).\n",
  },
  { from: "_content/box/session", to: "_bookkeeping/archive/session" },
  ["_bookkeeping/archive/session/note.doc.card"],
)
=>
success
>> _bookkeeping/archive/session/note.doc.card
---
type: doc
---
By [Dana](../../../_content/box/people/dana.person.card), see [scan](scan.capture-session.card).
```

A card inside the moved directory that names a sibling file by a
*box-absolute* path — the legacy capture layout, where an image card's
`filename.ref` is the absolute path of its own photo — follows the move and
keeps the absolute style. An absolute ref to something that did not move is
unchanged. A single card that names a file in its own attach directory by
absolute path gets the new attach path:

```ts
await moved(
  {
    "_content/box/session/photo-004.jpg": "JPG",
    "_content/box/session/photo-004-Beach.image.card":
      "---\nfilename:\n  ref: /_content/box/session/photo-004.jpg\n---\nSee [Dana](/_content/box/people/dana.person.card).\n",
    "_content/box/people/dana.person.card": "---\nname: Dana\n---\n",
  },
  { from: "_content/box/session", to: "_bookkeeping/archive/session" },
  ["_bookkeeping/archive/session/photo-004-Beach.image.card"],
)
=>
success
>> _bookkeeping/archive/session/photo-004-Beach.image.card
---
filename:
  ref: /_bookkeeping/archive/session/photo-004.jpg
---
See [Dana](/_content/box/people/dana.person.card).
```

```ts
await moved(
  {
    "_content/box/Beach.attach/photo.jpg": "JPG",
    "_content/box/Beach.image.card": "---\nfilename:\n  ref: /_content/box/Beach.attach/photo.jpg\n---\n",
  },
  { from: "_content/box/Beach.image.card", to: "_content/trips/Beach.image.card" },
  ["_content/trips/Beach.image.card"],
)
=>
success
>> _content/trips/Beach.image.card
---
filename:
  ref: /_content/trips/Beach.attach/photo.jpg
---
```

A move to a path with a space writes inbound markdown links in CommonMark's
angle-bracket form, since a bare destination ends at the first space.
`bbx validate` reads that form, and the next move rewrites it again, keeping
the brackets as it keeps every link's style:

```ts
const links = await withBox(
  {
    "_content/cap/Beach.image.card": "---\ntitle: Beach\n---\n",
    "_content/notes/trip.doc.card": "---\ntitle: Trip\n---\n![b](/_content/cap/Beach.image.card)\n",
  },
  async (box) => {
    await mv(box, { from: "_content/cap/Beach.image.card", to: "_content/cap/Beach walk.image.card" });
    const trip = await box.read("_content/notes/trip.doc.card");
    const spaced = trip.includes("![b](</_content/cap/Beach walk.image.card>)");
    const refs = extractBodyLinks(trip.split("---\n")[2] ?? "").map((l) => l.ref);

    await mv(box, { from: "_content/cap/Beach walk.image.card", to: "_content/cap/Walk.image.card" });
    const rewritten = (await box.read("_content/notes/trip.doc.card")).includes("![b](</_content/cap/Walk.image.card>)");
    return { spaced, refs, rewritten };
  },
);
links
=> { spaced: true, refs: ["/_content/cap/Beach walk.image.card"], rewritten: true }
```

## Rename in place (same directory)

A card can be renamed within its directory; refs follow the new basename and
the attach directory is renamed alongside.

```ts
await moved(
  {
    "_content/box/Old_Name.doc.card": "---\ntype: doc\ntitle: Old\n---\nbody\n",
    "_content/box/Old_Name.attach/note.txt": "hi",
    "_content/box/ref.memo.card": "---\ntype: memo\nref: /_content/box/Old_Name.doc.card\n---\nlink [n](Old_Name.attach/note.txt)\n",
  },
  { from: "_content/box/Old_Name.doc.card", to: "_content/box/New_Name.doc.card" },
  ["_content/box/", "_content/box/ref.memo.card"],
)
=>
success
>> ls _content/box
_content/box/New_Name.attach
_content/box/New_Name.attach/note.txt
_content/box/New_Name.doc.card
_content/box/ref.memo.card
>> _content/box/ref.memo.card
---
type: memo
ref: /_content/box/New_Name.doc.card
---
link [n](New_Name.attach/note.txt)
```

## YAML block scalars are prose, trailing comments survive

The frontmatter scan is line-based, so it has to know the two YAML constructs
where a ref-shaped line isn't a ref. A **block scalar** (`notes: |`) holds
literal prose — a `- ref: Plan.doc.card` line inside it is text that must be
left exactly as written, not rewritten (that would be silent text corruption).
An **end-of-line comment** (`# the plan`) is not part of the ref: it used to be
captured as part of the token, which then never resolved, so `bbx mv` silently
skipped the ref and left it dangling. Both refs below are rewritten, comments
intact.

The **body** scan takes the opposite posture on fenced code: `bbx mv` rewrites a
fenced example too, because a doc example naming a card that moved should stay
truthful rather than point at a dead path.

```ts
const FENCE = "`".repeat(3);
const text = await moved(
  {
    "_content/store/notes/Plan.doc.card": "---\ntype: doc\ntitle: Plan\n---\nbody\n",
    "_content/store/notes/Index.memo.card":
      "---\ntype: memo\nref: Plan.doc.card  # the plan\nitems:\n  - ref: Plan.doc.card # also\n" +
      "notes: |\n  Write it as:\n  - ref: Plan.doc.card\n---\n" +
      "Inline [plan](Plan.doc.card).\n" +
      FENCE + "md\nFenced [plan](Plan.doc.card)\n" + FENCE + "\n",
  },
  { from: "_content/store/notes/Plan.doc.card", to: "_bookkeeping/archive/Plan.doc.card" },
  ["_content/store/notes/Index.memo.card"],
);
text.split("\n").filter((line) => line.includes("Plan.doc.card")).join("\n")
=>
ref: ../../../_bookkeeping/archive/Plan.doc.card  # the plan
  - ref: ../../../_bookkeeping/archive/Plan.doc.card # also
  - ref: Plan.doc.card
Inline [plan](../../../_bookkeeping/archive/Plan.doc.card).
Fenced [plan](../../../_bookkeeping/archive/Plan.doc.card)
```

## Scheme refs (`mailto:`, `view:`) are never resolved, even on a name collision

Whether a ref names something outside the box is decided by one shared test
(`isExternalRef` in `src/shared/ref-path/core.ts`) — the same one BBX002 uses — not by
looking for `://`. This box deliberately constructs the collision that the
narrower test missed: files whose names are literally `mailto:dana.doc.card` and
`view:Ledger.doc.card`, so a scheme ref would resolve to a card that is moving.
The refs stay exactly as written.

```ts
await moved(
  {
    "_content/store/mailto:dana.doc.card": "---\ntype: doc\ntitle: Dana\n---\nx\n",
    "_content/store/view:Ledger.doc.card": "---\ntype: doc\ntitle: Ledger\n---\nx\n",
    "_content/store/Index.doc.card": indexCard("Mail [d](mailto:dana.doc.card), view [l](view:Ledger.doc.card)."),
  },
  { from: ["_content/store/mailto:dana.doc.card", "_content/store/view:Ledger.doc.card"], to: "_bookkeeping/archive/" },
  ["_content/store/Index.doc.card"],
)
=>
success
>> _content/store/Index.doc.card
---
type: doc
title: Index
---
Mail [d](mailto:dana.doc.card), view [l](view:Ledger.doc.card).
```

## Dry run makes no changes

```ts
await moved(
  {
    "_content/box/A.doc.card": "---\ntype: doc\n---\nbody\n",
    "_content/box/B.memo.card": "---\ntype: memo\nref: /_content/box/A.doc.card\n---\nx\n",
  },
  { from: "_content/box/A.doc.card", to: "_content/store/A.doc.card", dryRun: true },
  ["_content/box/", "_content/box/B.memo.card"],
)
=>
success
>> ls _content/box
_content/box/A.doc.card
_content/box/B.memo.card
>> _content/box/B.memo.card
---
type: memo
ref: /_content/box/A.doc.card
---
x
```

## Moving multiple cards into a directory

Several sources and a directory destination move each card (and its attach
dir) under the destination.

```ts
await moved(
  {
    "_content/inbox/One.memo.card": "---\ntype: memo\n---\none\n",
    "_content/inbox/Two.memo.card": "---\ntype: memo\n---\ntwo\n",
  },
  { from: ["_content/inbox/One.memo.card", "_content/inbox/Two.memo.card"], to: "_content/store/kept/" },
  ["_content/store/kept/"],
)
=>
success
>> ls _content/store/kept
_content/store/kept/One.memo.card
_content/store/kept/Two.memo.card
```

## Errors

A source that is not a card, a `.md` file, or a directory is rejected. A move
keeps the file's kind: a `.md` file cannot become a card. Moving multiple
cards to a single file destination is rejected.

```ts
({
  notACard: await rejected({}, { from: "_content/box/notes.txt", to: "_content/store/notes.txt" }),
  mdToCard: await rejected({ "_content/box/notes.md": "# Notes\n" }, { from: "_content/box/notes.md", to: "_content/store/Notes.doc.card" }),
  manyToFile: await rejected(
    { "_content/box/A.memo.card": "---\ntype: memo\n---\n", "_content/box/B.memo.card": "---\ntype: memo\n---\n" },
    { from: ["_content/box/A.memo.card", "_content/box/B.memo.card"], to: "_content/store/C.memo.card" },
  ),
})
=> {
  notACard: { success: false, error: "Source must be a .card file, a .md file, or a directory: _content/box/notes.txt" },
  mdToCard: { success: false, error: "Destination must be a .md file: _content/store/Notes.doc.card" },
  manyToFile: { success: false, error: "Moving multiple cards requires a directory destination" }
}
```

## Plain `.md` dossier links are rewritten too

A non-card markdown dossier (e.g. a notebook character sheet) that embeds a
box-root-absolute link to a card is rewritten when that card moves — the case
that broke before `bbx mv` covered `.md` files. Only inline links change; the
dossier has no frontmatter to re-serialize.

```ts
await moved(
  {
    "_content/store/old/Pic.doc.card": "---\ntype: doc\ntitle: Pic\n---\nx\n",
    "_content/store/dossiers/saoirse.md": "# Saoirse\n\n![face](/_content/store/old/Pic.doc.card)\n",
  },
  { from: "_content/store/old/Pic.doc.card", to: "_content/store/new/Pic.doc.card" },
  ["_content/store/dossiers/saoirse.md"],
)
=>
success
>> _content/store/dossiers/saoirse.md
# Saoirse
«blankline»
![face](/_content/store/new/Pic.doc.card)
```

## Moving a plain `.md` file

A plain `.md` file moves or renames like a card. Cards and other `.md` files that link
to it are rewritten in whichever style they used, and the moved file's own
relative links are recomputed from its new location. A `.md` file has no
attach scope, so nothing else moves with it.

```ts
const result = await withBox(
  {
    "_content/notes/saoirse.md": "# Saoirse\n\nSee [Dana](dana.person.card).\n",
    "_content/notes/dana.person.card": "---\nname: Dana\n---\n",
    "_content/index.doc.card": "---\ntitle: Index\n---\n[S](/_content/notes/saoirse.md)\n",
    "_content/other.md": "[S](notes/saoirse.md)\n",
  },
  async (box) => {
    const first = await mv(box, { from: "_content/notes/saoirse.md", to: "_content/dossiers/" });
    const firstMove = {
      success: first.success,
      dossier: (await box.read("_content/dossiers/saoirse.md")).includes("See [Dana](../notes/dana.person.card)."),
      indexCard: (await box.read("_content/index.doc.card")).includes("[S](/_content/dossiers/saoirse.md)"),
      otherMd: await box.read("_content/other.md"),
    };
    const renamed = await mv(box, { from: "_content/dossiers/saoirse.md", to: "_content/dossiers/saoirse-2026.md" });
    return { moved: firstMove, renamed: renamed.success, dossiers: await box.list("_content/dossiers") };
  },
);
result
=> {
  moved: { success: true, dossier: true, indexCard: true, otherMd: "[S](dossiers/saoirse.md)\n" },
  renamed: true,
  dossiers: "_content/dossiers/saoirse-2026.md"
}
```

## Directory moves rewrite `.md` dossiers too — inside and outside the move

A directory move gets the same `.md` coverage a single-card move has, and
respects the same inside/outside split as cards: a dossier *outside* the moved
directory has its links into the directory repointed (absolute and relative
alike), while a dossier that *travelled with* the directory keeps its link to a
sibling that moved alongside it and has its outgoing relative links recomputed
from the new location. (Before this, `bbx mv <dir>` walked cards and views only,
so a dossier's links silently dangled.)

```ts
await moved(
  {
    "_content/box/people/dana.person.card": "---\ntype: person\nname: Dana\n---\n",
    "_content/box/session/scan.capture-session.card": "---\nsession-id: s\n---\n",
    "_content/store/dossiers/log.md":
      "# Log\n\nAbs [scan](/_content/box/session/scan.capture-session.card), rel [again](../../box/session/scan.capture-session.card).\n",
    "_content/box/session/readme.md":
      "# Session\n\nRun by [Dana](../people/dana.person.card); the [scan](scan.capture-session.card) is here.\n",
  },
  { from: "_content/box/session", to: "_bookkeeping/archive/session" },
  ["_content/store/dossiers/log.md", "_bookkeeping/archive/session/readme.md"],
)
=>
success
>> _content/store/dossiers/log.md
# Log
«blankline»
Abs [scan](/_bookkeeping/archive/session/scan.capture-session.card), rel [again](../../../_bookkeeping/archive/session/scan.capture-session.card).
>> _bookkeeping/archive/session/readme.md
# Session
«blankline»
Run by [Dana](../../../_content/box/people/dana.person.card); the [scan](scan.capture-session.card) is here.
```

## A display-form path argument is rejected, not treated as a file path

`Config:box.json` and `Bookkeeping:jobs/x.job.card` (the boxholder's display
vocabulary) are rejected with a message naming the canonical form, whether
written as the source or the destination
(`docs/plans/display-path-guard.subplan.md`):

```ts
({
  from: await rejected({}, { from: "Config:box.json", to: "_content/box/notes/Elsewhere.doc.card" }),
  to: await rejected(
    { "_content/box/notes/Real.doc.card": "---\ntype: doc\ntitle: Real\n---\n" },
    { from: "_content/box/notes/Real.doc.card", to: "Bookkeeping:jobs/x.job.card" },
  ),
})
=> {
  from: { success: false, error: "`Config:box.json` is the boxholder's display form; write `/_config/box.json`" },
  to: { success: false, error: "`Bookkeeping:jobs/x.job.card` is the boxholder's display form; write `/_bookkeeping/jobs/x.job.card`" }
}
```
