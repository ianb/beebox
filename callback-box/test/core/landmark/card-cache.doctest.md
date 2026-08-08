# Landmark card parse cache

`readLandmarkCard` memoizes the read-and-YAML-parse of one `*.landmark.card`, so
the whole-box scans behind the place picker (`loadLandmarkSummaries`) and the
filing pickers (`listDestinations`) don't re-parse every card on every call.

The cache is the risky half of that speedup: **a stale picker is worse than a
slow one.** So the tests below are about invalidation, driven through
`loadLandmarkSummaries` — the caller users actually feel — rather than the memo
in isolation. The three things that must always show up: a card that appeared, a
card that changed, and a card that went away.

```ts setup
import * as fs from "node:fs/promises";
import { loadLandmarkSummaries } from "../../../src/core/landmark/summaries.js";
import { readLandmarkCard } from "../../../src/core/landmark/card-cache.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

/** Labels of a box's landmarks, in scan order. */
async function labels(root: string): Promise<string> {
  const { summaries } = await loadLandmarkSummaries(root);
  return summaries.map((s) => s.label).join(",");
}
```

## An added card appears on the next scan

Nothing about "which cards exist" is cached — only the parse of a card's current
bytes — so a new landmark needs no invalidation to be found.

```ts
const box = await makeTmpBox();
await box.write("Box.landmark.card", "---\nnavigation:\n  label: Home\n---\n");

await labels(box.root)
=> Home

await box.write("recipes/R.landmark.card", "---\nnavigation:\n  label: Recipes\n---\n");
await labels(box.root)
=> Home,Recipes
```

```ts cleanup
await box.cleanup();
```

## An edited card is re-read, even when the edit doesn't change its size

The hazard case. `Home` → `Away` is the same byte count, so a cache keyed on
size alone would serve the old label forever; the mtime in the key is what
catches it.

```ts
const box = await makeTmpBox();
await box.write("Box.landmark.card", "---\nnavigation:\n  label: Home\n---\n");

await labels(box.root)
=> Home

await box.write("Box.landmark.card", "---\nnavigation:\n  label: Away\n---\n");
await labels(box.root)
=> Away
```

A card edited from valid to unparseable moves into `problems` rather than
lingering as its last good parse.

```ts continue
await box.write("Box.landmark.card", "not a frontmatter card at all\n");
const after = await loadLandmarkSummaries(box.root);
JSON.stringify([after.summaries.length, after.problems])
=> [0,[{"path":"Box.landmark.card"}]]
```

```ts cleanup
await box.cleanup();
```

## A replaced card is re-read, even when it keeps its size and mtime

An atomic write (`writeFileAtomic`, `git checkout`, most editors) replaces the
file rather than rewriting it, which gives a new inode. Restoring the *old*
bytes under a copied timestamp is the one case size and mtime both miss — the
inode in the key is what makes it a miss.

```ts
const box = await makeTmpBox();
const cardPath = box.path("Box.landmark.card");
await box.write("Box.landmark.card", "---\nnavigation:\n  label: Home\n---\n");
const stamped = (await fs.stat(cardPath)).mtime;

await labels(box.root)
=> Home

// Replace by rename, then forge the original mtime back onto the new inode.
await fs.writeFile(box.path("staging.tmp"), "---\nnavigation:\n  label: Away\n---\n");
await fs.rename(box.path("staging.tmp"), cardPath);
await fs.utimes(cardPath, stamped, stamped);
await labels(box.root)
=> Away
```

```ts cleanup
await box.cleanup();
```

## A deleted card leaves the scan

```ts
const box = await makeTmpBox();
await box.write("Box.landmark.card", "---\nnavigation:\n  label: Home\n---\n");
await box.write("recipes/R.landmark.card", "---\nnavigation:\n  label: Recipes\n---\n");

await labels(box.root)
=> Home,Recipes

await fs.rm(box.path("recipes/R.landmark.card"));
await labels(box.root)
=> Home
```

```ts cleanup
await box.cleanup();
```

## A missing card is the caller's error, not a cached null

`readLandmarkCard` distinguishes "doesn't parse as a landmark" (null, and
cached) from "isn't there" (the fs error, which propagates). The scans rely on
that split: a `null` is a reportable `problems` entry, an `ENOENT` is a card
that vanished between the glob and the read.

```ts
const box = await makeTmpBox();
await box.write("Bad.landmark.card", "not a frontmatter card at all\n");

await readLandmarkCard(box.path("Bad.landmark.card"))
=> null

await readLandmarkCard(box.path("Nope.landmark.card")).catch((e) => e.code)
=> ENOENT
```

```ts cleanup
await box.cleanup();
```
