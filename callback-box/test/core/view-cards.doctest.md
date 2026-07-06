# Loading view cards

`loadViewCards(boxRoot, dependencies)` resolves a view's dependency globs to the
cards and files it renders — the same data the `/api/views/:slug/cards` route
serves. It additionally reports cards that matched a glob but failed to load
(`skipped`), which the route drops but `cb view test` surfaces.

```ts setup
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { loadViewCards } from "../../src/core/views/cards.js";

const MEMO_CARD = `---
status: new
created: 2026-03-01T12:00:00Z
---
Test memo content
`;
```

## Cards and files

A dependency glob selecting a card returns it as a `ViewCard`, with non-card
matches arriving in `files` as metadata:

```ts
const box = await makeTmpBox();
await box.write("box/inbox/Test.memo.card", MEMO_CARD);
await box.write("box/inbox/Test.attach/notes.txt", "hello");

const result = await loadViewCards(box.root, ["box/**/*.card", "box/**/*.txt"]);
result.cards.length
=> 1

result.cards[0].type
=> memo

result.cards[0].path
=> box/inbox/Test.memo.card

result.cards[0].frontmatter.status
=> new

result.files.map((f) => f.path).join(", ")
=> box/inbox/Test.attach/notes.txt

JSON.stringify(result.skipped)
=> []
```

```ts cleanup
await box.cleanup();
```

## No dependencies

A view with no dependency globs loads nothing:

```ts
const box = await makeTmpBox();
const result = await loadViewCards(box.root, []);
JSON.stringify(result)
=> {"cards":[],"files":[],"skipped":[]}
```

```ts cleanup
await box.cleanup();
```

## Skipped-card diagnostics

A card that matches a glob but fails to load (here: an unknown card type with no
registered schema) is omitted from `cards` and reported in `skipped` with its
path and the load error — so a test command can tell the author their dependency
selected an invalid card instead of silently rendering without it:

```ts
const box = await makeTmpBox();
await box.write("box/inbox/Good.memo.card", MEMO_CARD);
await box.write("box/inbox/Bad.bogus.card", "---\nstatus: new\n---\nno schema for this type\n");

const result = await loadViewCards(box.root, ["box/**/*.card"]);
result.cards.map((c) => c.path).join(", ")
=> box/inbox/Good.memo.card

result.skipped.map((s) => s.path).join(", ")
=> box/inbox/Bad.bogus.card

result.skipped[0].error.length > 0
=> true
```

```ts cleanup
await box.cleanup();
```
