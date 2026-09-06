# Migration: a landmark's `links:` targets pick up `prominence: primary`

`scripts/migrate/landmark-links-prominence.ts` gives every `navigation.links[]`
target inside a landmark's own pruned subtree `prominence: primary` when the
target has none yet. `migrateBox(absRoot, apply)` runs the whole migration
against a real directory tree and returns the report; the landmark card
itself is never written.

```ts setup
import { migrateBox } from "../../../scripts/migrate/landmark-links-prominence.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

/** Sort a report's arrays into a stable, readable string for comparison. */
function fmt(list: Array<{ ref: string; target?: string | null; reason?: string; level?: string }>): string {
  return list
    .map((e) => `${e.ref}${"target" in e ? ` -> ${String(e.target)}` : ""}${e.reason ? `: ${e.reason}` : ""}${e.level ? ` (${e.level})` : ""}`)
    .sort()
    .join("\n");
}
```

## A mixed landmark: in-subtree targets marked, everything else skipped with a reason

`Garden/` holds the landmark plus its targets: `Bread` is hand-labelled (not
a trim candidate once marked), `Soup` has no label (becomes one), `Outside`
sits in a sibling directory, `Missing` doesn't exist, `AlreadyMarked` already
carries a level, `Job` is a `category: "system"` type, and `Hidden` lives in
an OWNED attach scope with no landmark of its own — none of the last five are
touched.

```ts
const box = await makeTmpBox();
await box.write(
  "_content/Garden/Garden.landmark.card",
  `---
navigation:
  label: Garden
  links:
    - ref: /_content/Garden/Bread.memo.card
      label: the bread
    - ref: /_content/Garden/Soup.memo.card
    - ref: /_content/Elsewhere/Outside.memo.card
    - ref: /_content/Garden/Missing.memo.card
    - ref: /_content/Garden/AlreadyMarked.memo.card
    - ref: /_content/Garden/Job.contains-backfill-job.card
    - ref: /_content/Garden/Att.attach/Hidden.memo.card
---
`,
);
await box.write("_content/Garden/Bread.memo.card", "---\ndescription: test\n---\n");
await box.write("_content/Garden/Soup.memo.card", "---\ndescription: test\n---\n");
await box.write("_content/Elsewhere/Outside.memo.card", "---\n---\n");
await box.write("_content/Garden/AlreadyMarked.memo.card", "---\nprominence: background\n---\n");
await box.write("_content/Garden/Job.contains-backfill-job.card", "---\ndescription: test\nitems: []\n---\n");
await box.write("_content/Garden/Att.memo.card", "---\n---\n");
await box.write("_content/Garden/Att.attach/Hidden.memo.card", "---\n---\n");

const landmarkBefore = await box.read("_content/Garden/Garden.landmark.card");

const dry = await migrateBox(box.root, false);
fmt(dry.marked)
=> /_content/Garden/Bread.memo.card -> /_content/Garden/Bread.memo.card
/_content/Garden/Soup.memo.card -> /_content/Garden/Soup.memo.card

fmt(dry.skipped)
=> /_content/Elsewhere/Outside.memo.card -> /_content/Elsewhere/Outside.memo.card: target is outside the landmark's pruned subtree
/_content/Garden/AlreadyMarked.memo.card -> /_content/Garden/AlreadyMarked.memo.card: target already has prominence: background
/_content/Garden/Att.attach/Hidden.memo.card -> /_content/Garden/Att.attach/Hidden.memo.card: target is outside the landmark's pruned subtree
/_content/Garden/Job.contains-backfill-job.card -> /_content/Garden/Job.contains-backfill-job.card: target's card type is category: system
/_content/Garden/Missing.memo.card -> /_content/Garden/Missing.memo.card: target does not exist (bbx validate already flags this ref)

fmt(dry.trimCandidates)
=> /_content/Garden/Soup.memo.card -> /_content/Garden/Soup.memo.card (primary)

dry.failed.length
=> 0
```

`Hidden` resolves to a real path (the ref has a leading `/`, so it's a
literal box path, not the `attach/`-relative form) but the walk never reaches
it: `prunedSubtree` skips an owned attach scope with no landmark of its own
entirely, so it's never in `cardBoxPaths` — same "outside the pruned
subtree" reason as a card in an unrelated directory. A dry run touches
nothing on disk:

```ts continue
await box.read("_content/Garden/Bread.memo.card")
=> ---
description: test
---

await box.read("_content/Garden/Garden.landmark.card")
=> ---
navigation:
  label: Garden
  links:
    - ref: /_content/Garden/Bread.memo.card
      label: the bread
    - ref: /_content/Garden/Soup.memo.card
    - ref: /_content/Elsewhere/Outside.memo.card
    - ref: /_content/Garden/Missing.memo.card
    - ref: /_content/Garden/AlreadyMarked.memo.card
    - ref: /_content/Garden/Job.contains-backfill-job.card
    - ref: /_content/Garden/Att.attach/Hidden.memo.card
---
```

Applying writes exactly the two eligible targets, inserting one line each and
leaving the rest of the frontmatter block untouched:

```ts continue
const applied = await migrateBox(box.root, true);
fmt(applied.marked)
=> /_content/Garden/Bread.memo.card -> /_content/Garden/Bread.memo.card
/_content/Garden/Soup.memo.card -> /_content/Garden/Soup.memo.card

await box.read("_content/Garden/Bread.memo.card")
=> ---
description: test
prominence: primary
---

await box.read("_content/Garden/Soup.memo.card")
=> ---
description: test
prominence: primary
---

await box.read("_content/Garden/AlreadyMarked.memo.card")
=> ---
prominence: background
---
```

The landmark itself is byte-identical — no link was added, removed, or
reordered:

```ts continue
(await box.read("_content/Garden/Garden.landmark.card")) === landmarkBefore
=> true
```

## Idempotent: a second run marks nothing, and still reports the trim candidate

```ts continue
const again = await migrateBox(box.root, true);
again.marked.length
=> 0

fmt(again.skipped.filter((s) => s.reason.startsWith("target already has prominence")))
=> /_content/Garden/AlreadyMarked.memo.card -> /_content/Garden/AlreadyMarked.memo.card: target already has prominence: background
/_content/Garden/Bread.memo.card -> /_content/Garden/Bread.memo.card: target already has prominence: primary
/_content/Garden/Soup.memo.card -> /_content/Garden/Soup.memo.card: target already has prominence: primary

fmt(again.trimCandidates)
=> /_content/Garden/Soup.memo.card -> /_content/Garden/Soup.memo.card (primary)
```

`Bread` never becomes a trim candidate — it carries a hand-written label, so
the derived list surfacing its `primary` level doesn't make the link
redundant.

```ts cleanup
await box.cleanup();
```

## A ref with a fragment names its card

`Bread.recipe.card#notes` is a valid link (the renderer scrolls to `notes`);
the migration resolves the path part and marks `Bread`, never treating the
fragment as part of the filename.

```ts
const fragBox = await makeTmpBox();
await fragBox.write(
  "_content/Kitchen/Kitchen.landmark.card",
  "---\nnavigation:\n  label: Kitchen\n  links:\n    - ref: /_content/Kitchen/Bread.memo.card#notes\n---\n",
);
await fragBox.write("_content/Kitchen/Bread.memo.card", "---\ndescription: test\n---\n");
const fragRun = await migrateBox(fragBox.root, true);
fmt(fragRun.marked)
=> /_content/Kitchen/Bread.memo.card#notes -> /_content/Kitchen/Bread.memo.card

(await fragBox.read("_content/Kitchen/Bread.memo.card")).includes("prominence: primary")
=> true
```

```ts cleanup
await fragBox.cleanup();
```
