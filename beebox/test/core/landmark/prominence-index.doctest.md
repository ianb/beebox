# The prominence index — pruned subtrees

`prunedSubtree(boxRoot, dir)` answers "which cards under this landmark's
directory carry a level, and what does the pruned tree boil down to" —
`docs/implemented-plans/card-prominence.md`, Track B. It stops at any directory that has
its own landmark card (contributing one `nested` entry instead), never
enters an OWNED `<basename>.attach/` scope unless that scope holds its own
landmark, and folds to nothing under a `background` landmark — the top one
or any ancestor.

```ts setup
import { utimes } from "node:fs/promises";
import { prunedSubtree } from "../../../src/core/landmark/prominence-index.js";
import { getParseCount, resetParseCount } from "../../../src/core/landmark/prominence-cache.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

/** Sort ProminenceEntry[] into a stable, readable string for comparison. */
function fmt(entries: { boxPath: string; level: string; kind: string }[]): string {
  return entries
    .map((e) => `${e.kind}:${e.level} ${e.boxPath}`)
    .sort()
    .join("\n");
}
```

## A directory of mixed cards: only non-ordinary levels are indexed

```ts
const box = await makeTmpBox();
await box.write("_content/Entry.memo.card", "---\nprominence: entry-point\n---\n");
await box.write("_content/Primary1.memo.card", "---\nprominence: primary\n---\n");
await box.write("_content/Primary2.memo.card", "---\nprominence: primary\n---\n");
await box.write("_content/Ordinary.memo.card", "---\n---\n");
// A system-category card is background BY TYPE with no declared prominence.
await box.write("_content/Job.contains-backfill-job.card", "---\ndescription: test\nitems: []\n---\n");

const { entries, nested, summary } = await prunedSubtree(box.root, "");
fmt(entries)
=>
card:background /_content/Job.contains-backfill-job.card
card:entry-point /_content/Entry.memo.card
card:primary /_content/Primary1.memo.card
card:primary /_content/Primary2.memo.card

nested.length
=> 0

JSON.stringify(summary)
=> {"hasEntryPoint":true,"primaryCount":2,"background":false}
```

```ts cleanup
await box.cleanup();
```

## A nested landmark stops the walk and contributes one entry

A `primary` card inside a directory that has its own landmark card is never
indexed by the OUTER pruned subtree — the nested landmark is the one entry,
and the box path is a `kind: "landmark"` entry too (`nested` carries its
tile metadata; `entries` carries it so the resolver can place it in its own
tier).

```ts
const box = await makeTmpBox();
await box.write("_content/Sub/Sub.landmark.card", "---\nnavigation:\n  label: Sub\n---\n");
await box.write("_content/Sub/SubPrimary.memo.card", "---\nprominence: primary\n---\n");

const { entries, nested, summary } = await prunedSubtree(box.root, "");
fmt(entries)
=> landmark:background /_content/Sub/Sub.landmark.card

nested.map((n) => n.label).join(",")
=> Sub

JSON.stringify(summary)
=> {"hasEntryPoint":false,"primaryCount":0,"background":false}
```

```ts cleanup
await box.cleanup();
```

## A background landmark contributes nothing, and excludes its subtree

A landmark written `prominence: background` is not itself an entry (it
contributes NOTHING, not even a background-level entry) and its cards never
count toward the outer directory's summary.

```ts
const box = await makeTmpBox();
await box.write("_content/BG/BG.landmark.card", "---\nprominence: background\n---\n");
await box.write("_content/BG/BGPrimary.memo.card", "---\nprominence: primary\n---\n");

const { entries, nested, summary } = await prunedSubtree(box.root, "");
fmt(entries)
=>


nested.length
=> 0

JSON.stringify(summary)
=> {"hasEntryPoint":false,"primaryCount":0,"background":false}
```

```ts cleanup
await box.cleanup();
```

## An owned attach scope is skipped, not walked

A card living inside its owner's `<basename>.attach/` directory is folded
into the owner everywhere else in the app (Browse); the pruned walk follows
the same fold and never surfaces it as its own entry.

```ts
const box = await makeTmpBox();
await box.write("_content/Att.memo.card", "---\n---\n");
await box.write("_content/Att.attach/AttPrimary.memo.card", "---\nprominence: primary\n---\n");

const { entries, summary } = await prunedSubtree(box.root, "");
fmt(entries)
=>


JSON.stringify(summary)
=> {"hasEntryPoint":false,"primaryCount":0,"background":false}
```

An attach scope that holds ITS OWN landmark card is a nested landmark like
any other, not skipped:

```ts continue
await box.write("_content/Course.memo.card", "---\n---\n");
await box.write("_content/Course.attach/Course.landmark.card", "---\nnavigation:\n  label: Course notes\n---\n");
await box.write("_content/Course.attach/CoursePrimary.memo.card", "---\nprominence: primary\n---\n");

const after = await prunedSubtree(box.root, "");
after.nested.map((n) => n.label).sort().join(",")
=> Course notes
```

```ts cleanup
await box.cleanup();
```

## A `background` ancestor landmark folds a directory with no landmark of its own

`Deeper/` has no landmark card, but its ancestor `BG/` is a `background`
landmark — the cascade folds `Deeper` too.

```ts
const box = await makeTmpBox();
await box.write("_content/BG/BG.landmark.card", "---\nprominence: background\n---\n");
await box.write("_content/BG/Deeper/DeeperPrimary.memo.card", "---\nprominence: primary\n---\n");

const { entries, summary } = await prunedSubtree(box.root, "_content/BG/Deeper");
fmt(entries)
=>


JSON.stringify(summary)
=> {"hasEntryPoint":false,"primaryCount":0,"background":true}
```

The root landmark is the box's identity, not a place that can be
housekeeping: `background` written there is ignored (and lint-warned), so the
root's own walk and every descendant's still run.

```ts continue
await box.write("_content/Box.landmark.card", "---\nprominence: background\nnavigation:\n  label: Box\n---\n");
await box.write("_content/Top.memo.card", "---\nprominence: primary\n---\n");
const root = await prunedSubtree(box.root, "");
fmt(root.entries)
=> card:primary /_content/Top.memo.card

root.summary.background
=> false
```

```ts cleanup
await box.cleanup();
```

## Ordinary cards are listed with their mtimes

`ordinary` lists every `ordinary`-level card the walk reached, with its file
mtime, for the place page's "Also here" group. A briefing is ordinary: the
person reads it as their own page. Chat husks, capture sessions and upload
batches are `background` by type, so they are not listed; neither is a card
inside a nested place.

```ts
const box = await makeTmpBox();
await box.write("_content/Groceries.memo.card", "---\n---\n");
await box.write("_content/Box.briefing.card", "---\n---\nAbout this box.\n");
await box.write("_content/chat/web/Hello.chat.card", "---\nsession: s1\n---\n");
await box.write("_content/tmp-capture/Walk.capture-session.card", "---\n---\n");
await box.write("_content/tmp-upload/Batch.upload-batch.card", "---\n---\n");
await box.write("_content/Sub/Sub.landmark.card", "---\nnavigation:\n  label: Sub\n---\n");
await box.write("_content/Sub/Nested.memo.card", "---\n---\n");
await utimes(box.path("_content/Groceries.memo.card"), 1_700_000_000, 1_700_000_000);
await utimes(box.path("_content/Box.briefing.card"), 1_700_000_100, 1_700_000_100);

const { ordinary, entries } = await prunedSubtree(box.root, "");
ordinary
  .map((o) => `${o.boxPath} ${o.mtimeMs}`)
  .sort()
  .join("\n")
=>
/_content/Box.briefing.card 1700000100000
/_content/Groceries.memo.card 1700000000000

fmt(entries)
=>
card:background /_content/chat/web/Hello.chat.card
card:background /_content/tmp-capture/Walk.capture-session.card
card:background /_content/tmp-upload/Batch.upload-batch.card
landmark:background /_content/Sub/Sub.landmark.card
```

```ts cleanup
await box.cleanup();
```

## A warm second call parses nothing

The per-file cache (`prominence-cache.ts`) memoizes each file's parse by
identity; only discovery (the `readdir` walk itself) repeats.

```ts
const box = await makeTmpBox();
await box.write("_content/Entry.memo.card", "---\nprominence: entry-point\n---\n");
await box.write("_content/Sub/Sub.landmark.card", "---\nnavigation:\n  label: Sub\n---\n");

await prunedSubtree(box.root, "");

resetParseCount();
await prunedSubtree(box.root, "");
getParseCount()
=> 0
```

```ts cleanup
await box.cleanup();
```

## A large box stays cached

A walk reads every card under its place, so the cache must hold a whole
large box. A cap of 4,096 files once cleared the cache partway through every
walk of a box with about 9,000 cards, and each walk parsed every card again.
Here 4,500 cards, more than that old cap, are all parsed once and then never
again.

```ts
const box = await makeTmpBox();
await Promise.all(
  Array.from({ length: 4500 }, (_, i) => box.write(`_content/d${i % 30}/Card${i}.memo.card`, "---\n---\n")),
);

resetParseCount();
await prunedSubtree(box.root, "");
const cold = getParseCount();
resetParseCount();
await prunedSubtree(box.root, "");
({ cold, warm: getParseCount() })
=> { cold: 4500, warm: 0 }
```

```ts cleanup
await box.cleanup();
```
