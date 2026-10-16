# Loading view cards

`loadViewCards(boxRoot, dependencies)` resolves a view's dependency globs to the
cards and files it renders — the same data the `/api/views/:slug/cards` route
serves. It additionally reports cards that matched a glob but failed to load
(`skipped`), which the route drops but `bbx view test` surfaces.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { loadViewCards } from "../../../src/core/views/cards.js";

const DOC_CARD = `---
title: Test
---
Test doc content
`;
```

## Cards and files

A dependency glob selecting a card returns it as a `ViewCard`, with non-card
matches arriving in `files` as metadata:

```ts
const box = await makeTmpBox();
await box.write("_content/inbox/Test.doc.card", DOC_CARD);
await box.write("_content/inbox/Test.attach/notes.txt", "hello");

const result = await loadViewCards(box.root, ["_content/**/*.card", "_content/**/*.txt"]);
result.cards.length
=> 1

result.cards[0]?.type
=> doc

result.cards[0]?.path
=> _content/inbox/Test.doc.card

result.cards[0]?.frontmatter?.title
=> Test

result.cards[0]?.body
=> Test doc content
```

`bodyLineOffset` counts the file lines before the body, from the same split
the todo collector uses, so a todo a view renders through `Markdown` gets the
collector's locator. The doc's frontmatter block is three lines:

```ts continue
result.cards[0]?.bodyLineOffset
=> 3

result.files.map((f) => f.path).join(", ")
=> _content/inbox/Test.attach/notes.txt

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
await box.write("_content/inbox/Good.doc.card", DOC_CARD);
await box.write("_content/inbox/Bad.bogus.card", "---\nstatus: new\n---\nno schema for this type\n");

const result = await loadViewCards(box.root, ["_content/**/*.card"]);
result.cards.map((c) => c.path).join(", ")
=> _content/inbox/Good.doc.card

result.skipped.map((s) => s.path).join(", ")
=> _content/inbox/Bad.bogus.card

(result.skipped[0]?.error.length ?? 0) > 0
=> true
```

```ts cleanup
await box.cleanup();
```

## Round-7 hardening finding 2: a box-wide glob never reaches package internals

`**/*.doc.card` from the unified root would otherwise reach a package-internal
`src/private.doc.card` too — a dependency is box CONTENT by definition, so
every glob's root is restricted to the underscore areas before it ever
matches:

```ts
const box = await makeTmpBox();
await box.write("_content/inbox/Real.doc.card", DOC_CARD);
await box.write("src/private.doc.card", DOC_CARD);

const result = await loadViewCards(box.root, ["**/*.doc.card"]);
result.cards.map((c) => c.path).join(", ")
=> _content/inbox/Real.doc.card
```

```ts cleanup
await box.cleanup();
```

## An escaping leaf symlink is dropped, not served

A dependency glob matching INSIDE an underscore area can still name a leaf
symlink whose target resolves OUTSIDE the box namespace — the match is
dropped rather than served:

```ts
const box = await makeTmpBox();
const outside = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-outside-"));
await fs.writeFile(path.join(outside, "secret.card"), DOC_CARD);
await fs.mkdir(box.path("_content/inbox"), { recursive: true });
await fs.symlink(path.join(outside, "secret.card"), box.path("_content/inbox/Escape.doc.card"));
await box.write("_content/inbox/Real.doc.card", DOC_CARD);

const result = await loadViewCards(box.root, ["_content/**/*.card"]);
result.cards.map((c) => c.path).join(", ")
=> _content/inbox/Real.doc.card
```

```ts cleanup
await box.cleanup();
await fs.rm(outside, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
```
