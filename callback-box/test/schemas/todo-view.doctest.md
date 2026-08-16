# `todo-view` card schema

Frontmatter-only schema for the `todo-view` card
(`docs/implemented-plans/todo-annotation.md` Track 4): `glob`/`status`/`assigned` are the
query, no body. `glob` has NO schema default (pinned mechanism detail — see
`src/schemas/todo-view.ts`'s module doc) — an omitted `glob` is resolved
server-side by `todos.list`, from the card's own path, not by this schema.

```ts setup
import { TodoViewSchema, createTodoViewTemplate } from "../../src/schemas/todo-view.js";
import { getCardTypes, getDefaultTemplate } from "../../src/schemas/index.js";
import { parseCardText } from "../../src/core/card-io.js";
import { createCardSchemaMap } from "../../src/schemas/registry.js";

const schemas = await createCardSchemaMap();
```

## Registered as `todo-view`, in the schema registry, with a default template

```ts
TodoViewSchema.type
=> todo-view

getCardTypes().includes("todo-view")
=> true

getDefaultTemplate("todo-view").name
=> todo-view
```

## A bare card (no fields at all) loads fine — `glob` has no default

```ts
const bare = "---\n{}\n---\n";
const parsed = parseCardText(bare, { source: "store/plate.todo-view.card", schemas, type: "todo-view" });
parsed.fields.glob
=> undefined
```

## `glob`/`status`/`assigned` all load when present

```ts
const full = "---\nglob: \"store/projects/kitchen/**\"\nstatus:\n  - open\n  - parked\nassigned: agent\n---\n";
const parsedFull = parseCardText(full, { source: "store/kitchen/plate.todo-view.card", schemas, type: "todo-view" });
parsedFull.fields.glob
=> store/projects/kitchen/**

JSON.stringify(parsedFull.fields.status)
=> ["open","parked"]

parsedFull.fields.assigned
=> agent
```

## An out-of-enum `status` value is rejected

```ts
TodoViewSchema.frontmatterSchema.safeParse({ type: "todo-view", status: ["not-a-status"] }).success
=> false
```

## Template generation: omitted `glob` (subtree default) vs. explicit `glob: "**"` (the stock box-wide instance)

```ts
const subtree = createTodoViewTemplate({ title: "Kitchen Remodel" });
subtree.includes("glob:")
=> false

subtree.includes("title: Kitchen Remodel")
=> true

const boxWide = createTodoViewTemplate({ glob: "**", title: "The Plate" });
boxWide.includes('glob: "**"')
=> true
```

A card generated from the box-wide template round-trips through
`parseCardText`:

```ts continue
const parsedBoxWide = parseCardText(boxWide, { source: "store/plate.todo-view.card", schemas, type: "todo-view" });
parsedBoxWide.fields.glob
=> **
```
