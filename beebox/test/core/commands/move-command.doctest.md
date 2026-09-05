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
import { executeMove } from "../../../src/core/commands/move.js";
import { createCollectorContext } from "../../../src/core/commands/index.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

async function mv(box, args) {
  const { ctx } = createCollectorContext(box.root);
  return executeMove(ctx, args);
}
```

## Phase-2 card: file + attach dir move, inbound refs rewritten (relative + absolute, into attachments too)

Moving a frontmatter card carries its `.attach/` directory along. Other cards
that link to the card — or *into* its attach directory — are rewritten whether
they used a relative or a box-root-absolute path. The moved card's own relative
links to cards that stayed put are rewritten too, while its `attach/`-prefixed
self references (scoped to the card) are left untouched.

```ts
const box = await makeTmpBox();
await box.write(
  "_content/box/notes/Engine.doc.card",
  "---\ntype: doc\ntitle: Engine\n---\n# Engine\nPhoto: ![p](attach/photo.jpg)\nRelated: [Priya](Priya.doc.card)\n",
);
await box.write("_content/box/notes/Engine.attach/photo.jpg", "JPG");
await box.write(
  "_content/box/notes/Priya.doc.card",
  "---\ntype: doc\ntitle: Priya\n---\nSee [Engine](Engine.doc.card) and its [photo](Engine.attach/photo.jpg).\n",
);
await box.write(
  "_content/box/index.doc.card",
  "---\ntype: doc\ntitle: Index\n---\nAbs [Engine](/_content/box/notes/Engine.doc.card) and [photo](/_content/box/notes/Engine.attach/photo.jpg).\n",
);

const result = await mv(box, { from: "_content/box/notes/Engine.doc.card", to: "_bookkeeping/archive/Engine.doc.card" });
result.success
=> true
```

The card file and its attach directory now live under `_bookkeeping/archive/`:

```ts continue
await box.list("_bookkeeping/archive")
=>
_bookkeeping/archive/Engine.attach
_bookkeeping/archive/Engine.attach/photo.jpg
_bookkeeping/archive/Engine.doc.card
_bookkeeping/archive/done
_bookkeeping/archive/done/.gitkeep
_bookkeeping/archive/failed
_bookkeeping/archive/failed/.gitkeep
_bookkeeping/archive/processed
_bookkeeping/archive/processed/.gitkeep

await box.read("_bookkeeping/archive/Engine.attach/photo.jpg")
=> JPG
```

The moved card keeps its `attach/` self-ref and gets a recomputed relative link
to the card that stayed behind:

```ts continue
await box.read("_bookkeeping/archive/Engine.doc.card")
=>
---
type: doc
title: Engine
---
# Engine
Photo: ![p](attach/photo.jpg)
Related: [Priya](../../_content/box/notes/Priya.doc.card)
```

The sibling card's relative links — to the card and into its attach dir — are
recomputed from its own location:

```ts continue
await box.read("_content/box/notes/Priya.doc.card")
=>
---
type: doc
title: Priya
---
See [Engine](../../../_bookkeeping/archive/Engine.doc.card) and its [photo](../../../_bookkeeping/archive/Engine.attach/photo.jpg).
```

The absolute links stay absolute, repointed at the new location:

```ts continue
await box.read("_content/box/index.doc.card")
=>
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
dir and an inbound ref moves cleanly.

```ts
const box = await makeTmpBox();
await box.write(
  "_content/box/bills/Water.bill.card",
  "---\nstatus: due\nvendor: City Water\namount: 42.5\n---\nScan: ![s](attach/scan.pdf)\n",
);
await box.write("_content/box/bills/Water.attach/scan.pdf", "PDF");
await box.write(
  "_content/box/index.doc.card",
  "---\ntype: doc\ntitle: Index\n---\nUnpaid: [Water](/_content/box/bills/Water.bill.card).\n",
);

const result = await mv(box, { from: "_content/box/bills/Water.bill.card", to: "_bookkeeping/archive/Water.bill.card" });
result.success
=> true
```

The card and its attach directory moved, and the inbound absolute ref was
repointed:

```ts continue
await box.list("_bookkeeping/archive")
=>
_bookkeeping/archive/Water.attach
_bookkeeping/archive/Water.attach/scan.pdf
_bookkeeping/archive/Water.bill.card
_bookkeeping/archive/done
_bookkeeping/archive/done/.gitkeep
_bookkeeping/archive/failed
_bookkeeping/archive/failed/.gitkeep
_bookkeeping/archive/processed
_bookkeeping/archive/processed/.gitkeep

await box.read("_content/box/index.doc.card")
=>
---
type: doc
title: Index
---
Unpaid: [Water](/_bookkeeping/archive/Water.bill.card).
```

## Body Markdoc `{% source ref %}` rewritten (relative + absolute)

Refs carried by Markdoc body tags follow the move in either style.

```ts
const box = await makeTmpBox();
await box.write("_content/box/people/dana.person.card", "---\ntype: person\nname: Dana\n---\n");
await box.write(
  "_content/box/notes/Mtg.doc.card",
  '---\ntype: doc\ntitle: Mtg\n---\n' +
    'Abs: {% source ref="/_content/box/people/dana.person.card" usage="x" %}a{% /source %}\n' +
    'Rel: {% source ref="../people/dana.person.card" usage="y" %}b{% /source %}\n',
);

await mv(box, { from: "_content/box/people/dana.person.card", to: "_content/store/people/dana.person.card" });
await box.read("_content/box/notes/Mtg.doc.card")
=>
---
type: doc
title: Mtg
---
Abs: {% source ref="/_content/store/people/dana.person.card" usage="x" %}a{% /source %}
Rel: {% source ref="../../store/people/dana.person.card" usage="y" %}b{% /source %}
```

## Frontmatter `ref:` / `refs:` rewritten (relative + absolute)

Both the singular `ref:` scalar and `refs:` list entries follow the move, each
keeping its own style.

```ts
const box = await makeTmpBox();
await box.write("_content/box/a/Target.doc.card", "---\ntype: doc\ntitle: Target\n---\nbody\n");
await box.write(
  "_content/box/a/Ref.memo.card",
  "---\ntype: memo\nref: /_content/box/a/Target.doc.card\nrefs:\n  - Target.doc.card\n  - /_content/box/a/Target.doc.card\n---\nbody\n",
);

await mv(box, { from: "_content/box/a/Target.doc.card", to: "_content/box/b/Target.doc.card" });
await box.read("_content/box/a/Ref.memo.card")
=>
---
type: memo
ref: /_content/box/b/Target.doc.card
refs:
  - ../b/Target.doc.card
  - /_content/box/b/Target.doc.card
---
body
```

## Nested frontmatter `ref:` (under a non-`ref` key) rewritten

A card reference is always stored under a key named exactly `ref`, even when
nested under another field (e.g. a landmark destination's
`procedure:\n  ref: …`). The move rewrites it the same as a top-level `ref:`.

```ts
const box = await makeTmpBox();
await box.write("_content/recipes/archive.procedure.card", "---\nsteps: []\n---\nbody\n");
await box.write(
  "_content/recipes/Recipes.landmark.card",
  "---\ndestinations:\n  - for: [triage]\n    procedure:\n      ref: archive.procedure.card\n---\n",
);

await mv(box, { from: "_content/recipes/archive.procedure.card", to: "_content/store/handlers/archive.procedure.card" });
await box.read("_content/recipes/Recipes.landmark.card")
=>
---
destinations:
  - for: [triage]
    procedure:
      ref: ../store/handlers/archive.procedure.card
---
```

## Block-list `- ref:` items rewritten

The most common nested ref shape is `ref` as the FIRST key of a block-list item
(`messages:`/`items:`/`participants:` lists). It follows the move like any other
`ref:`, whether it was written relative or box-root-absolute.

```ts
const box = await makeTmpBox();
await box.write("_content/store/notes/Plan.doc.card", "---\ntype: doc\ntitle: Plan\n---\nbody\n");
await box.write(
  "_content/store/notes/Index.memo.card",
  "---\ntype: memo\nitems:\n  - ref: Plan.doc.card\n    note: rel\n  - ref: /_content/store/notes/Plan.doc.card\n---\nbody\n",
);

await mv(box, { from: "_content/store/notes/Plan.doc.card", to: "_bookkeeping/archive/Plan.doc.card" });
await box.read("_content/store/notes/Index.memo.card")
=>
---
type: memo
items:
  - ref: ../../../_bookkeeping/archive/Plan.doc.card
    note: rel
  - ref: /_bookkeeping/archive/Plan.doc.card
---
body
```

## Single card move: `ref=` strings in referrers rewritten (relative + absolute)

Moving a card rewrites references to it in other cards via substring rewrite —
a relative ref becomes relative to the new location, an absolute (box-root) ref
stays box-root-absolute. (No leading `./`; that was a cardworks XML-loader
artifact, gone now that every card is frontmatter.)

```ts
const box = await makeTmpBox();
await box.write("_content/store/Scan.capture-session.card", "---\nsession-id: s\n---\n");
await box.write(
  "_content/store/Guide.guide.card",
  '---\nversion: "1.0.0"\n---\nrel [a](Scan.capture-session.card) abs [b](/_content/store/Scan.capture-session.card)\n',
);

await mv(box, { from: "_content/store/Scan.capture-session.card", to: "_content/store/sub/Scan.capture-session.card" });
(await box.read("_content/store/Guide.guide.card")).trim()
=>
---
version: "1.0.0"
---
rel [a](sub/Scan.capture-session.card) abs [b](/_content/store/sub/Scan.capture-session.card)
```

## `?query` and `#fragment` survive the rewrite

A ref may address a location *within* its target — `?view=ledger` picks a view,
`#risks` an anchor. Resolution runs on the path part only (so the ref still
matches the moving card), and the suffix is re-appended to the rewritten ref in
whichever style it was written.

```ts
const box = await makeTmpBox();
await box.write("_content/store/charts/Ledger.doc.card", "---\ntype: doc\ntitle: Ledger\n---\nx\n");
await box.write(
  "_content/store/Index.doc.card",
  "---\ntype: doc\ntitle: Index\n---\n" +
    "rel [view](charts/Ledger.doc.card?view=ledger) abs [anchor](/_content/store/charts/Ledger.doc.card#risks)\n" +
    "both [x](charts/Ledger.doc.card?view=ledger#risks)\n",
);

await mv(box, { from: "_content/store/charts/Ledger.doc.card", to: "_bookkeeping/archive/Ledger.doc.card" });
(await box.read("_content/store/Index.doc.card")).trim()
=>
---
type: doc
title: Index
---
rel [view](../../_bookkeeping/archive/Ledger.doc.card?view=ledger) abs [anchor](/_bookkeeping/archive/Ledger.doc.card#risks)
both [x](../../_bookkeeping/archive/Ledger.doc.card?view=ledger#risks)
```

```ts continue
await box.cleanup();
```

## Directory move: recursive, external refs rewritten (relative + absolute)

Moving a directory carries everything under it. References from outside the
directory — to anything inside it — are rewritten in either style.

```ts
const box = await makeTmpBox();
await box.write("_content/box/session/scan.capture-session.card", "<capture-session>\n<note>s</note>\n</capture-session>\n");
await box.write("_content/box/session/photo.image.card", "---\ntype: image\n---\n");
await box.write(
  "_content/box/notes/other.doc.card",
  "---\ntype: doc\n---\nAbs [scan](/_content/box/session/scan.capture-session.card) rel [scan2](../session/scan.capture-session.card)\n",
);

const result = await mv(box, { from: "_content/box/session", to: "_bookkeeping/archive/session" });
result.success
=> true

await box.list("_bookkeeping/archive/session")
=>
_bookkeeping/archive/session/photo.image.card
_bookkeeping/archive/session/scan.capture-session.card

await box.read("_content/box/notes/other.doc.card")
=>
---
type: doc
---
Abs [scan](/_bookkeeping/archive/session/scan.capture-session.card) rel [scan2](../../../_bookkeeping/archive/session/scan.capture-session.card)
```

A card *inside* the moved directory that links *out* of it (by a relative
path) has that link recomputed from its new location; links to siblings that
moved with it are unchanged.

```ts
const box = await makeTmpBox();
await box.write("_content/box/people/dana.person.card", "---\ntype: person\nname: Dana\n---\n");
await box.write("_content/box/session/scan.capture-session.card", "<capture-session>\n<note>s</note>\n</capture-session>\n");
await box.write(
  "_content/box/session/note.doc.card",
  "---\ntype: doc\n---\nBy [Dana](../people/dana.person.card), see [scan](scan.capture-session.card).\n",
);

await mv(box, { from: "_content/box/session", to: "_bookkeeping/archive/session" });
await box.read("_bookkeeping/archive/session/note.doc.card")
=>
---
type: doc
---
By [Dana](../../../_content/box/people/dana.person.card), see [scan](scan.capture-session.card).
```

## Rename in place (same directory)

A card can be renamed within its directory; refs follow the new basename and
the attach directory is renamed alongside.

```ts
const box = await makeTmpBox();
await box.write("_content/box/Old_Name.doc.card", "---\ntype: doc\ntitle: Old\n---\nbody\n");
await box.write("_content/box/Old_Name.attach/note.txt", "hi");
await box.write("_content/box/ref.memo.card", "---\ntype: memo\nref: /_content/box/Old_Name.doc.card\n---\nlink [n](Old_Name.attach/note.txt)\n");

await mv(box, { from: "_content/box/Old_Name.doc.card", to: "_content/box/New_Name.doc.card" });
await box.list("_content/box")
=>
_content/box/New_Name.attach
_content/box/New_Name.attach/note.txt
_content/box/New_Name.doc.card
_content/box/ref.memo.card

await box.read("_content/box/ref.memo.card")
=>
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
const box = await makeTmpBox();
await box.write("_content/store/notes/Plan.doc.card", "---\ntype: doc\ntitle: Plan\n---\nbody\n");
await box.write(
  "_content/store/notes/Index.memo.card",
  "---\ntype: memo\nref: Plan.doc.card  # the plan\nitems:\n  - ref: Plan.doc.card # also\n" +
    "notes: |\n  Write it as:\n  - ref: Plan.doc.card\n---\n" +
    "Inline [plan](Plan.doc.card).\n" +
    FENCE + "md\nFenced [plan](Plan.doc.card)\n" + FENCE + "\n",
);

await mv(box, { from: "_content/store/notes/Plan.doc.card", to: "_bookkeeping/archive/Plan.doc.card" });
const index = await box.read("_content/store/notes/Index.memo.card");
index.split("\n").filter((line) => line.includes("Plan.doc.card")).join("\n")
=>
ref: ../../../_bookkeeping/archive/Plan.doc.card  # the plan
  - ref: ../../../_bookkeeping/archive/Plan.doc.card # also
  - ref: Plan.doc.card
Inline [plan](../../../_bookkeeping/archive/Plan.doc.card).
Fenced [plan](../../../_bookkeeping/archive/Plan.doc.card)
```

```ts continue
await box.cleanup();
```

## Scheme refs (`mailto:`, `view:`) are never resolved, even on a name collision

Whether a ref names something outside the box is decided by one shared test
(`isExternalRef` in `src/shared/ref-path.ts`) — the same one BBX002 uses — not by
looking for `://`. This box deliberately constructs the collision that the
narrower test missed: files whose names are literally `mailto:dana.doc.card` and
`view:Ledger.doc.card`, so a scheme ref would resolve to a card that is moving.
The refs stay exactly as written.

```ts
const box = await makeTmpBox();
await box.write("_content/store/mailto:dana.doc.card", "---\ntype: doc\ntitle: Dana\n---\nx\n");
await box.write("_content/store/view:Ledger.doc.card", "---\ntype: doc\ntitle: Ledger\n---\nx\n");
await box.write(
  "_content/store/Index.doc.card",
  "---\ntype: doc\ntitle: Index\n---\nMail [d](mailto:dana.doc.card), view [l](view:Ledger.doc.card).\n",
);

const result = await mv(box, {
  from: ["_content/store/mailto:dana.doc.card", "_content/store/view:Ledger.doc.card"],
  to: "_bookkeeping/archive/",
});
result.success
=> true

await box.read("_content/store/Index.doc.card")
=>
---
type: doc
title: Index
---
Mail [d](mailto:dana.doc.card), view [l](view:Ledger.doc.card).
```

```ts continue
await box.cleanup();
```

## Dry run makes no changes

```ts
const box = await makeTmpBox();
await box.write("_content/box/A.doc.card", "---\ntype: doc\n---\nbody\n");
await box.write("_content/box/B.memo.card", "---\ntype: memo\nref: /_content/box/A.doc.card\n---\nx\n");

const result = await mv(box, { from: "_content/box/A.doc.card", to: "_content/store/A.doc.card", dryRun: true });
result.success
=> true

await box.list("_content/box")
=>
_content/box/A.doc.card
_content/box/B.memo.card

await box.read("_content/box/B.memo.card")
=>
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
const box = await makeTmpBox();
await box.write("_content/inbox/One.memo.card", "---\ntype: memo\n---\none\n");
await box.write("_content/inbox/Two.memo.card", "---\ntype: memo\n---\ntwo\n");

const result = await mv(box, { from: ["_content/inbox/One.memo.card", "_content/inbox/Two.memo.card"], to: "_content/store/kept/" });
result.success
=> true

await box.list("_content/store/kept")
=>
_content/store/kept/One.memo.card
_content/store/kept/Two.memo.card
```

## Errors

A non-card, non-directory source is rejected.

```ts
const box = await makeTmpBox();
const result = await mv(box, { from: "_content/box/notes.txt", to: "_content/store/notes.txt" });
result.success
=> false

result.error
=> Source must be a .card file or directory: _content/box/notes.txt
```

Moving multiple cards to a single file destination is rejected.

```ts
const box = await makeTmpBox();
await box.write("_content/box/A.memo.card", "---\ntype: memo\n---\n");
await box.write("_content/box/B.memo.card", "---\ntype: memo\n---\n");
const result = await mv(box, { from: ["_content/box/A.memo.card", "_content/box/B.memo.card"], to: "_content/store/C.memo.card" });
result.success
=> false

result.error
=> Moving multiple cards requires a directory destination
```

## Plain `.md` dossier links are rewritten too

A non-card markdown dossier (e.g. a notebook character sheet) that embeds a
box-root-absolute link to a card is rewritten when that card moves — the case
that broke before `bbx mv` covered `.md` files. Only inline links change; the
dossier has no frontmatter to re-serialize.

```ts
const box = await makeTmpBox();
await box.write("_content/store/old/Pic.doc.card", "---\ntype: doc\ntitle: Pic\n---\nx\n");
await box.write(
  "_content/store/dossiers/saoirse.md",
  "# Saoirse\n\n![face](/_content/store/old/Pic.doc.card)\n",
);

const result = await mv(box, { from: "_content/store/old/Pic.doc.card", to: "_content/store/new/Pic.doc.card" });
result.success
=> true
```

```ts continue
const saoirse = await box.read("_content/store/dossiers/saoirse.md");
[saoirse.includes("![face](/_content/store/new/Pic.doc.card)"), saoirse.includes("/_content/store/old/")]
=>
[
  true,
  false
]
```

```ts continue
await box.cleanup();
```

## Directory moves rewrite `.md` dossiers too — inside and outside the move

A directory move gets the same `.md` coverage a single-card move has, and
respects the same inside/outside split as cards: a dossier *outside* the moved
directory has its links into the directory repointed, while a dossier that
*travelled with* the directory has its outgoing relative links recomputed from
the new location. (Before this, `bbx mv <dir>` walked cards and views only, so a
dossier's links silently dangled.)

```ts
const box = await makeTmpBox();
await box.write("_content/box/people/dana.person.card", "---\ntype: person\nname: Dana\n---\n");
await box.write("_content/box/session/scan.capture-session.card", "---\nsession-id: s\n---\n");
await box.write(
  "_content/store/dossiers/log.md",
  "# Log\n\nAbs [scan](/_content/box/session/scan.capture-session.card), rel [again](../../box/session/scan.capture-session.card).\n",
);
await box.write(
  "_content/box/session/readme.md",
  "# Session\n\nRun by [Dana](../people/dana.person.card); the [scan](scan.capture-session.card) is here.\n",
);

const result = await mv(box, { from: "_content/box/session", to: "_bookkeeping/archive/session" });
result.success
=> true
```

The outside dossier's links — absolute and relative alike — now point at the
new location:

```ts continue
await box.read("_content/store/dossiers/log.md")
=>
# Log
«blankline»
Abs [scan](/_bookkeeping/archive/session/scan.capture-session.card), rel [again](../../../_bookkeeping/archive/session/scan.capture-session.card).
```

The dossier that moved with the directory keeps its link to a sibling that
moved alongside it, and gets a recomputed path to the card that stayed put:

```ts continue
await box.read("_bookkeeping/archive/session/readme.md")
=>
# Session
«blankline»
Run by [Dana](../../../_content/box/people/dana.person.card); the [scan](scan.capture-session.card) is here.
```

```ts continue
await box.cleanup();
```

## A display-form path argument is rejected, not treated as a file path

`Config:box.json` and `Bookkeeping:jobs/x.job.card` (the boxholder's display
vocabulary) are rejected with a message naming the canonical form, whether
written as the source or the destination
(`docs/plans/display-path-guard.subplan.md`):

```ts
const dbox = await makeTmpBox();
await dbox.write("_content/box/notes/Real.doc.card", "---\ntype: doc\ntitle: Real\n---\n");

const fromRejected = await mv(dbox, { from: "Config:box.json", to: "_content/box/notes/Elsewhere.doc.card" });
JSON.stringify(fromRejected)
=> {"success":false,"error":"`Config:box.json` is the boxholder's display form; write `/_config/box.json`"}

const toRejected = await mv(dbox, { from: "_content/box/notes/Real.doc.card", to: "Bookkeeping:jobs/x.job.card" });
JSON.stringify(toRejected)
=> {"success":false,"error":"`Bookkeeping:jobs/x.job.card` is the boxholder's display form; write `/_bookkeeping/jobs/x.job.card`"}
```
