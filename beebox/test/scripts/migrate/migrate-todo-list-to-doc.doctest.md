# Migration: retire `todo-list` → `doc` with embedded `{% todo %}`

`scripts/migrate/todo-list-to-doc.ts` exports the pure per-card transform,
`convertTodoListCard(raw)`. It converts a `.todo-list.card`'s frontmatter
(`name`, `details`, `agent-notes`, `items[]`) into a `.doc.card`'s shape
(`title:` + a markdown body): items become a list, each wrapped in
`{% todo %}…{% /todo %}`; nested items become an indented sub-list; the
status vocabulary maps pending → open (no attribute), done → `status="done"`,
cancelled → `status="dropped"`, deferred → `status="parked"`; a `completed`
timestamp (the tag deliberately has no attribute for it) becomes a trailing
"(completed …)" parenthetical inside the wrapped text; item/card `agent-notes`
become prose (inline parenthetical for items, a blockquote for the card).
Anything outside this mapping is reported in `warnings`, never silently
dropped. `scripts/migrate/todo-list-to-doc-run.ts` is the CLI driver (file
walk, rename, box-wide inbound-ref rewrite) — exercised separately below via
`makeTmpBox` + a subprocess, since it isn't a pure function.

```ts setup
import { convertTodoListCard } from "../../../scripts/migrate/todo-list-to-doc.js";
```

## A plain list of pending items — the common case

```ts
const card = `---
name: Weekend Errands
items:
  - name: Buy groceries
    status: pending
  - name: Mow lawn
    status: pending
  - name: Return library books
    status: pending
---
`;
const result = convertTodoListCard(card);
result.content
=> ---
title: Weekend Errands
---
- {% todo %}Buy groceries{% /todo %}
- {% todo %}Mow lawn{% /todo %}
- {% todo %}Return library books{% /todo %}

result.warnings
=> []
```

## Status mapping: done/cancelled/deferred, and a `completed` timestamp survives as text

```ts
const card2 = `---
name: Mixed Statuses
items:
  - name: Buy groceries
    status: done
    completed: "2026-06-14T10:00:00Z"
  - name: Cancel gym membership
    status: cancelled
  - name: Fix the fence
    status: deferred
---
`;
const r2 = convertTodoListCard(card2);
r2.content.includes('{% todo status="done" %}Buy groceries (completed 2026-06-14T10:00:00Z){% /todo %}')
=> true

r2.content.includes('{% todo status="dropped" %}Cancel gym membership{% /todo %}')
=> true

r2.content.includes('{% todo status="parked" %}Fix the fence{% /todo %}')
=> true

r2.warnings
=> []
```

## Card-level `details` becomes the opening paragraph; card-level `agent-notes` becomes a trailing blockquote

```ts
const card3 = `---
name: Kitchen Remodel
details: Tracking the small stuff before the contractor starts.
agent-notes: Boxholder wants this list checked every Friday.
items:
  - name: Pick a tile color
    status: pending
---
`;
const r3 = convertTodoListCard(card3);
r3.content
=> ---
title: Kitchen Remodel
---
Tracking the small stuff before the contractor starts.
«blankline»
- {% todo %}Pick a tile color{% /todo %}
«blankline»
> Agent notes: Boxholder wants this list checked every Friday.
```

## Item-level `details` and `agent-notes` stay attached inside the wrapper; nested items become an indented sub-list

```ts
const card4 = `---
name: Garden Project
items:
  - name: Order soil
    status: pending
    details: Need at least 6 bags of raised-bed mix
    agent-notes: Boxholder mentioned this during the July 20 voice memo
    items:
      - name: Pick up from Rivermouth Nursery
        status: pending
---
`;
const r4 = convertTodoListCard(card4);
r4.content.includes("{% todo %}Order soil — Need at least 6 bags of raised-bed mix (agent note: Boxholder mentioned this during the July 20 voice memo){% /todo %}")
=> true

r4.content.includes("  - {% todo %}Pick up from Rivermouth Nursery{% /todo %}")
=> true

r4.warnings
=> []
```

## An unrecognized field anywhere is reported, never silently dropped

```ts
const card5 = `---
name: Odd Card
priority: high
items:
  - name: Do the thing
    status: pending
    owner: someone
---
`;
const r5 = convertTodoListCard(card5);
r5.warnings
=> [
  "unknown field at <todo-list>: \"priority\"",
  "unknown field at items[0]: \"owner\""
]
```

## An unrecognized status is preserved in text and warned about, not silently coerced

```ts
const card6 = `---
name: Weird Status
items:
  - name: Something
    status: someday
---
`;
const r6 = convertTodoListCard(card6);
r6.content.includes("{% todo %}Something (original status: someday){% /todo %}")
=> true

r6.warnings
=> [
  "item \"Something\": unrecognized status \"someday\" — left as open, original value kept in text"
]
```

## The universal `title`/`contains`/`todos` fields pass through; an explicit `title` wins over `name`

```ts
const card7 = `---
name: Errands
title: This Week's Errands
contains: A short list of weekend errands.
items:
  - name: Buy stamps
    status: pending
---
`;
const r7 = convertTodoListCard(card7);
r7.content
=> ---
title: This Week's Errands
contains: A short list of weekend errands.
---
- {% todo %}Buy stamps{% /todo %}
```

## No frontmatter, unparseable YAML, or no usable title → a dedicated error, not a silent skip

```ts
convertTodoListCard("no frontmatter here")
=> throws MissingFrontmatterError

convertTodoListCard("---\nname: [unclosed\n---\nbody")
=> throws UnparsableFrontmatterError

convertTodoListCard("---\nitems: []\n---\n")
=> throws MissingTitleError
```

## The CLI driver: conversion, idempotent re-run, and inbound-ref rewriting

```ts setup
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const RUN_SCRIPT = join(HERE, "../../../scripts/migrate/todo-list-to-doc-run.ts");

async function runMigrator(boxRoot, args = []) {
  try {
    const { stdout } = await execFileAsync("pnpm", ["exec", "tsx", RUN_SCRIPT, boxRoot, ...args], {
      cwd: join(HERE, "../../.."),
    });
    return stdout;
  } catch (e) {
    return `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
}
```

```ts
const box = await makeTmpBox();
await box.write("store/todos/Weekend_Errands.todo-list.card", `---
name: Weekend Errands
items:
  - name: Buy groceries
    status: pending
---
`);
await box.write("store/projects/Notes.memo.card", `---
status: processed
---
See ref="/store/todos/Weekend_Errands.todo-list.card" for the errands list.
`);

const dryRun = await runMigrator(box.root);
dryRun.includes("Dry run")
=> true

await box.read("store/todos/Weekend_Errands.todo-list.card")
=> ---
name: Weekend Errands
items:
  - name: Buy groceries
    status: pending
---

const applied = await runMigrator(box.root, ["--apply"]);
applied.includes("Converted 1")
=> true

await box.read("store/todos/Weekend_Errands.doc.card")
=> ---
title: Weekend Errands
---
- {% todo %}Buy groceries{% /todo %}

// The referring memo's ref was rewritten to the new path.
(await box.read("store/projects/Notes.memo.card")).includes("store/todos/Weekend_Errands.doc.card")
=> true

// Idempotent: a second run finds nothing to convert.
const second = await runMigrator(box.root, ["--apply"]);
second.includes("Nothing to do")
=> true
```

```ts cleanup
await box.cleanup();
```
