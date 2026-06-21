# Nearest landmark directory

Resolving the directory whose chat a "chat about this card" action binds to:
the deepest landmark directory that is an ancestor-or-self of the card's
directory, or `""` (the box root) when none encloses it. See
`src/core/landmark/nearest.ts` and `docs/plans/open-chat-from-card.md`.

```ts setup
import {
  nearestDirFromDirs,
  nearestLandmarkDir,
  isBoxRelativeCardPath,
} from "../src/core/landmark/nearest.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
```

## nearestDirFromDirs (pure matching)

Deepest enclosing landmark wins. With a root landmark (`""`) and a mid-tree one,
a card under the mid-tree dir binds to the deeper one:

```ts
nearestDirFromDirs("class/activities/shared/Logprobs.sandbox.card", ["", "class/activities"])
=> class/activities
```

A card with no enclosing non-root landmark falls back to the root (`""`):

```ts
JSON.stringify(nearestDirFromDirs("store/notes/idea.memo.card", ["class/activities"]))
=> ""
```

A card directly at the box root resolves to the root, never a sibling landmark:

```ts
JSON.stringify(nearestDirFromDirs("Inbox.memo.card", ["class/activities"]))
=> ""
```

A sibling/prefix-overlap dir does not falsely enclose — `class/act` must not
match a card under `class/activities/`:

```ts
nearestDirFromDirs("class/activities/x.card", ["class/act", "class/activities"])
=> class/activities
```

The landmark's own directory encloses cards sitting directly in it:

```ts
nearestDirFromDirs("class/activities/Index.card", ["class/activities"])
=> class/activities
```

## nearestLandmarkDir (globs the box)

Landmark directories are keyed on the `*.landmark.card` filename — a glob, no
parse — so the body's validity doesn't gate which directory counts as a
landmark. Seed a root and a nested landmark, then resolve a deep card:

```ts
const box = await makeTmpBox();
await box.write("Home.landmark.card", "---\ntype: landmark\n---\n");
await box.write("class/activities/Activities.landmark.card", "garbled not-even-yaml {{{");
await nearestLandmarkDir(box.root, { cardPath: "class/activities/shared/Logprobs.sandbox.card" })
=> class/activities
```

A card outside any landmarked subtree falls back to the root:

```ts
const box = await makeTmpBox();
await box.write("class/activities/Activities.landmark.card", "---\ntype: landmark\n---\n");
JSON.stringify(await nearestLandmarkDir(box.root, { cardPath: "store/notes/idea.memo.card" }))
=> ""
```

## isBoxRelativeCardPath (traversal guard)

The `?card=` value flows into `card.get`; `openForCard` rejects paths that could
escape the box:

```ts
[
  isBoxRelativeCardPath("class/activities/x.card"),
  isBoxRelativeCardPath("/etc/passwd"),
  isBoxRelativeCardPath("../../etc/passwd"),
  isBoxRelativeCardPath("a/../../b.card"),
].join(" ")
=> true false false false
```
