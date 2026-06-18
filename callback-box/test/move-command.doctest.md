# `cb mv` — move/rename cards and rewrite references

The move command relocates a card (or directory) and keeps every reference
pointing at the new location. References live in many places — frontmatter
`ref:`/`refs:`, body Markdoc tags (`{% source ref="…" %}`), inline markdown
links and images (`[text](path)`, `![alt](path)`), and XML body `ref=`
attributes — and may be written box-root-absolute (`/box/…`) or relative to
the referencing card. All of them follow the move, in whichever style they
were written. A card's sibling `<basename>.attach/` directory moves with it,
and references that point *into* that attach directory from other cards are
rewritten too.

```ts setup
import { executeMove } from "../src/core/commands/move.js";
import { createCollectorContext } from "../src/core/commands/index.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";

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

```
const box = await makeTmpBox();
await box.write(
  "box/notes/Engine.doc.card",
  "---\ntype: doc\ntitle: Engine\n---\n# Engine\nPhoto: ![p](attach/photo.jpg)\nRelated: [Priya](Priya.doc.card)\n",
);
await box.write("box/notes/Engine.attach/photo.jpg", "JPG");
await box.write(
  "box/notes/Priya.doc.card",
  "---\ntype: doc\ntitle: Priya\n---\nSee [Engine](Engine.doc.card) and its [photo](Engine.attach/photo.jpg).\n",
);
await box.write(
  "box/index.doc.card",
  "---\ntype: doc\ntitle: Index\n---\nAbs [Engine](/box/notes/Engine.doc.card) and [photo](/box/notes/Engine.attach/photo.jpg).\n",
);

const result = await mv(box, { from: "box/notes/Engine.doc.card", to: "store/archive/Engine.doc.card" });
result.success
=> true
```

The card file and its attach directory now live under `store/archive/`:

```continue
await box.list("store/archive")
=>
store/archive/Engine.attach
store/archive/Engine.attach/photo.jpg
store/archive/Engine.doc.card

await box.read("store/archive/Engine.attach/photo.jpg")
=> JPG
```

The moved card keeps its `attach/` self-ref and gets a recomputed relative link
to the card that stayed behind:

```continue
await box.read("store/archive/Engine.doc.card")
=>
---
type: doc
title: Engine
---
# Engine
Photo: ![p](attach/photo.jpg)
Related: [Priya](../../box/notes/Priya.doc.card)
```

The sibling card's relative links — to the card and into its attach dir — are
recomputed from its own location:

```continue
await box.read("box/notes/Priya.doc.card")
=>
---
type: doc
title: Priya
---
See [Engine](../../store/archive/Engine.doc.card) and its [photo](../../store/archive/Engine.attach/photo.jpg).
```

The absolute links stay absolute, repointed at the new location:

```continue
await box.read("box/index.doc.card")
=>
---
type: doc
title: Index
---
Abs [Engine](/store/archive/Engine.doc.card) and [photo](/store/archive/Engine.attach/photo.jpg).
```

## Body Markdoc `{% source ref %}` rewritten (relative + absolute)

Refs carried by Markdoc body tags follow the move in either style.

```
const box = await makeTmpBox();
await box.write("box/people/dana.person.card", "---\ntype: person\nname: Dana\n---\n");
await box.write(
  "box/notes/Mtg.doc.card",
  '---\ntype: doc\ntitle: Mtg\n---\n' +
    'Abs: {% source ref="/box/people/dana.person.card" as="x" %}a{% /source %}\n' +
    'Rel: {% source ref="../people/dana.person.card" as="y" %}b{% /source %}\n',
);

await mv(box, { from: "box/people/dana.person.card", to: "store/people/dana.person.card" });
await box.read("box/notes/Mtg.doc.card")
=>
---
type: doc
title: Mtg
---
Abs: {% source ref="/store/people/dana.person.card" as="x" %}a{% /source %}
Rel: {% source ref="../../store/people/dana.person.card" as="y" %}b{% /source %}
```

## Frontmatter `ref:` / `refs:` rewritten (relative + absolute)

Both the singular `ref:` scalar and `refs:` list entries follow the move, each
keeping its own style.

```
const box = await makeTmpBox();
await box.write("box/a/Target.doc.card", "---\ntype: doc\ntitle: Target\n---\nbody\n");
await box.write(
  "box/a/Ref.memo.card",
  "---\ntype: memo\nref: /box/a/Target.doc.card\nrefs:\n  - Target.doc.card\n  - /box/a/Target.doc.card\n---\nbody\n",
);

await mv(box, { from: "box/a/Target.doc.card", to: "box/b/Target.doc.card" });
await box.read("box/a/Ref.memo.card")
=>
---
type: memo
ref: /box/b/Target.doc.card
refs:
  - ../b/Target.doc.card
  - /box/b/Target.doc.card
---
body
```

## Legacy XML card: `ref=` attributes rewritten (relative + absolute)

XML-body cards (guide, capture-session, …) go through cardworks' loader, which
re-serializes `ref=` attributes in referrers — relative refs become relative
to the new location (cardworks writes a leading `./`), absolute refs stay
box-root-absolute.

```
const box = await makeTmpBox();
await box.write("store/Scan.capture-session.card", "<capture-session>\n<note>s</note>\n</capture-session>\n");
await box.write(
  "store/Guide.guide.card",
  '<guide>\n<see ref="Scan.capture-session.card"/>\n<see ref="/store/Scan.capture-session.card"/>\n</guide>\n',
);

await mv(box, { from: "store/Scan.capture-session.card", to: "store/sub/Scan.capture-session.card" });
await box.read("store/Guide.guide.card")
=>
<guide>
<see ref="./sub/Scan.capture-session.card"/>
<see ref="/store/sub/Scan.capture-session.card"/>
</guide>
```

## Directory move: recursive, external refs rewritten (relative + absolute)

Moving a directory carries everything under it. References from outside the
directory — to anything inside it — are rewritten in either style.

```
const box = await makeTmpBox();
await box.write("box/session/scan.capture-session.card", "<capture-session>\n<note>s</note>\n</capture-session>\n");
await box.write("box/session/photo.image.card", "---\ntype: image\n---\n");
await box.write(
  "box/notes/other.doc.card",
  "---\ntype: doc\n---\nAbs [scan](/box/session/scan.capture-session.card) rel [scan2](../session/scan.capture-session.card)\n",
);

const result = await mv(box, { from: "box/session", to: "store/archive/session" });
result.success
=> true

await box.list("store/archive/session")
=>
store/archive/session/photo.image.card
store/archive/session/scan.capture-session.card

await box.read("box/notes/other.doc.card")
=>
---
type: doc
---
Abs [scan](/store/archive/session/scan.capture-session.card) rel [scan2](../../store/archive/session/scan.capture-session.card)
```

A card *inside* the moved directory that links *out* of it (by a relative
path) has that link recomputed from its new location; links to siblings that
moved with it are unchanged.

```
const box = await makeTmpBox();
await box.write("box/people/dana.person.card", "---\ntype: person\nname: Dana\n---\n");
await box.write("box/session/scan.capture-session.card", "<capture-session>\n<note>s</note>\n</capture-session>\n");
await box.write(
  "box/session/note.doc.card",
  "---\ntype: doc\n---\nBy [Dana](../people/dana.person.card), see [scan](scan.capture-session.card).\n",
);

await mv(box, { from: "box/session", to: "store/archive/session" });
await box.read("store/archive/session/note.doc.card")
=>
---
type: doc
---
By [Dana](../../../box/people/dana.person.card), see [scan](scan.capture-session.card).
```

## Rename in place (same directory)

A card can be renamed within its directory; refs follow the new basename and
the attach directory is renamed alongside.

```
const box = await makeTmpBox();
await box.write("box/Old_Name.doc.card", "---\ntype: doc\ntitle: Old\n---\nbody\n");
await box.write("box/Old_Name.attach/note.txt", "hi");
await box.write("box/ref.memo.card", "---\ntype: memo\nref: /box/Old_Name.doc.card\n---\nlink [n](Old_Name.attach/note.txt)\n");

await mv(box, { from: "box/Old_Name.doc.card", to: "box/New_Name.doc.card" });
await box.list("box")
=>
box/New_Name.attach
box/New_Name.attach/note.txt
box/New_Name.doc.card
box/ref.memo.card

await box.read("box/ref.memo.card")
=>
---
type: memo
ref: /box/New_Name.doc.card
---
link [n](New_Name.attach/note.txt)
```

## Dry run makes no changes

```
const box = await makeTmpBox();
await box.write("box/A.doc.card", "---\ntype: doc\n---\nbody\n");
await box.write("box/B.memo.card", "---\ntype: memo\nref: /box/A.doc.card\n---\nx\n");

const result = await mv(box, { from: "box/A.doc.card", to: "store/A.doc.card", dryRun: true });
result.success
=> true

await box.list("box")
=>
box/A.doc.card
box/B.memo.card

await box.read("box/B.memo.card")
=>
---
type: memo
ref: /box/A.doc.card
---
x
```

## Moving multiple cards into a directory

Several sources and a directory destination move each card (and its attach
dir) under the destination.

```
const box = await makeTmpBox();
await box.write("box/inbox/One.memo.card", "---\ntype: memo\n---\none\n");
await box.write("box/inbox/Two.memo.card", "---\ntype: memo\n---\ntwo\n");

const result = await mv(box, { from: ["box/inbox/One.memo.card", "box/inbox/Two.memo.card"], to: "store/kept/" });
result.success
=> true

await box.list("store/kept")
=>
store/kept/One.memo.card
store/kept/Two.memo.card
```

## Errors

A non-card, non-directory source is rejected.

```
const box = await makeTmpBox();
const result = await mv(box, { from: "box/notes.txt", to: "store/notes.txt" });
result.success
=> false

result.error
=> Source must be a .card file or directory: box/notes.txt
```

Moving multiple cards to a single file destination is rejected.

```
const box = await makeTmpBox();
await box.write("box/A.memo.card", "---\ntype: memo\n---\n");
await box.write("box/B.memo.card", "---\ntype: memo\n---\n");
const result = await mv(box, { from: ["box/A.memo.card", "box/B.memo.card"], to: "store/C.memo.card" });
result.success
=> false

result.error
=> Moving multiple cards requires a directory destination
```
