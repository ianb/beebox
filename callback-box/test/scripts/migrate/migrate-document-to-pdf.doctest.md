# Migration: rename `document` card type to `pdf`

`scripts/migrate/document-to-pdf.ts` renames every `*.document.card` to
`*.pdf.card` (the type comes from the filename, so the rename *is* the type
change) and rewrites inbound `.document.card` references to `.pdf.card`.
`rewriteDocumentRefs(text)` is the pure ref-rewrite entry point;
`migrateBox(absRoot, apply)` runs both passes against a real directory tree
and returns the report.

```ts setup
import { migrateBox, rewriteDocumentRefs } from "../../../scripts/migrate/document-to-pdf.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
```

## A markdown link to a document card is rewritten

```ts
rewriteDocumentRefs("See [the scan](store/inbox/Invoice.document.card) for details.")
=> See [the scan](store/inbox/Invoice.pdf.card) for details.
```

## A box with one document card: renamed, refs rewritten, no collisions

```ts
const box = await makeTmpBox();
await box.write("store/inbox/Invoice.document.card", "---\nstatus: new\n---\nScan.\n");
await box.write("store/notes/Ref.memo.card", "---\nstatus: new\n---\nSee store/inbox/Invoice.document.card.\n");

const dry = await migrateBox(box.root, false);
JSON.stringify(dry)
=> {"renamed":["store/inbox/Invoice.document.card"],"refsRewritten":["store/notes/Ref.memo.card"],"collisions":[],"failed":[]}
```

A dry run touches nothing on disk:

```ts continue
await box.list("store/inbox")
=> store/inbox/Invoice.document.card

const applied = await migrateBox(box.root, true);
JSON.stringify(applied)
=> {"renamed":["store/inbox/Invoice.document.card"],"refsRewritten":["store/notes/Ref.memo.card"],"collisions":[],"failed":[]}

await box.list("store/inbox")
=> store/inbox/Invoice.pdf.card

await box.read("store/notes/Ref.memo.card")
=> ---
status: new
---
See store/inbox/Invoice.pdf.card.
```

```ts cleanup
await box.cleanup();
```

## Destination collision: an existing `Foo.pdf.card` refuses the rename, not overwrites it

POSIX `rename()` silently replaces an existing destination — renaming
`Foo.document.card` onto a `Foo.pdf.card` that's already there (e.g. left
over from a previous partial run, or an unrelated card that happens to share
the stem) would destroy it. `migrateBox` checks every destination before
renaming anything and refuses the whole run when a collision is found,
reporting the pair rather than picking a side:

```ts
const collideBox = await makeTmpBox();
await collideBox.write("store/inbox/Foo.document.card", "---\nstatus: new\n---\nOld scan.\n");
await collideBox.write("store/inbox/Foo.pdf.card", "---\nstatus: new\n---\nAlready-migrated content.\n");

const report = await migrateBox(collideBox.root, true);
JSON.stringify(report)
=> {"renamed":[],"refsRewritten":[],"collisions":[{"from":"store/inbox/Foo.document.card","to":"store/inbox/Foo.pdf.card"}],"failed":[]}
```

Neither file is touched — the pre-existing `Foo.pdf.card` keeps its own
content, and `Foo.document.card` is left in place for a human to resolve:

```ts continue
await collideBox.read("store/inbox/Foo.pdf.card")
=> ---
status: new
---
Already-migrated content.

await collideBox.read("store/inbox/Foo.document.card")
=> ---
status: new
---
Old scan.
```

A collision anywhere in the run also blocks the ref-rewrite pass, so a ref
is never repointed at a card whose rename didn't happen:

```ts continue
await collideBox.write("store/notes/Ref.memo.card", "---\nstatus: new\n---\nstore/inbox/Foo.document.card\n");
const reportWithRef = await migrateBox(collideBox.root, true);
reportWithRef.refsRewritten
=> []

await collideBox.read("store/notes/Ref.memo.card")
=> ---
status: new
---
store/inbox/Foo.document.card
```

```ts cleanup
await collideBox.cleanup();
```
