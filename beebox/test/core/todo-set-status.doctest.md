# Setting one todo's status (`core/todo/set-status.ts`)

`setTodoStatus` edits exactly the bytes that change: a body `{% todo %}`
tag's opening tag, or one frontmatter `todos:` entry's `status` field.
Everything else in the card is unchanged.

```ts setup
import { setTodoStatus, TodoLocatorNotFoundError } from "../../src/core/todo/set-status.js";
import { extractCardTodos } from "../../src/core/todo/extract.js";
import { buildLoadContext } from "../../src/core/load-context.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const box = await makeTmpBox();
const ctx = await buildLoadContext(box.root);
const CARD = "_content/Kitchen.memo.card";

// Four-line frontmatter block (the `memo` schema requires `created`), so
// body line 1 is file line 5.
function memo(body: string): string {
  return `---\nstatus: new\ncreated: 2026-07-01T10:00:00Z\n---\n${body}`;
}
```

## Inline tag: `done` inserts `status="done"` right after `todo`

```ts
setTodoStatus(memo("{% todo %}Buy milk{% /todo %}\n"), { locator: { kind: "body", line: 5 }, status: "done" })
=>
---
status: new
created: 2026-07-01T10:00:00Z
---
{% todo status="done" %}Buy milk{% /todo %}
```

## Block tag: the same edit, on its opening line only

```ts
setTodoStatus(memo(["{% todo %}", "Buy milk", "{% /todo %}", ""].join("\n")), {
  locator: { kind: "body", line: 5 },
  status: "done",
})
=>
---
status: new
created: 2026-07-01T10:00:00Z
---
{% todo status="done" %}
Buy milk
{% /todo %}
```

## Two todos on one line: `nth: 2` edits the second, the first is untouched

```ts
setTodoStatus(memo('{% todo %}One{% /todo %} {% todo %}Two{% /todo %}\n'), {
  locator: { kind: "body", line: 5, nth: 2 },
  status: "done",
})
=>
---
status: new
created: 2026-07-01T10:00:00Z
---
{% todo %}One{% /todo %} {% todo status="done" %}Two{% /todo %}
```

## Other attributes are kept, in the order they were written

`status` is always inserted right after `todo`, whatever else follows.

```ts
setTodoStatus(memo('{% todo assigned="agent" due="2026-08-01" %}Something{% /todo %}\n'), {
  locator: { kind: "body", line: 5 },
  status: "done",
})
=>
---
status: new
created: 2026-07-01T10:00:00Z
---
{% todo status="done" assigned="agent" due="2026-08-01" %}Something{% /todo %}
```

## `open` removes the `status` attribute entirely (absence means open)

```ts
setTodoStatus(memo('{% todo status="done" %}Buy milk{% /todo %}\n'), {
  locator: { kind: "body", line: 5 },
  status: "open",
})
=>
---
status: new
created: 2026-07-01T10:00:00Z
---
{% todo %}Buy milk{% /todo %}
```

`setTodoStatus` itself will overwrite any existing status — a `parked` todo
included. The caller (a later track's `todos.setStatus` mutation) is what
enforces `expectedStatus`, not this function.

```ts
setTodoStatus(memo('{% todo status="parked" %}Wait{% /todo %}\n'), {
  locator: { kind: "body", line: 5 },
  status: "done",
})
=>
---
status: new
created: 2026-07-01T10:00:00Z
---
{% todo status="done" %}Wait{% /todo %}
```

## Text after the closing tag, on the same line, is untouched

```ts
setTodoStatus(memo("{% todo %}Buy milk{% /todo %} — get whole milk\n"), {
  locator: { kind: "body", line: 5 },
  status: "done",
})
=>
---
status: new
created: 2026-07-01T10:00:00Z
---
{% todo status="done" %}Buy milk{% /todo %} — get whole milk
```

## Frontmatter entry: set and removal, body left byte-identical

```ts
const fm = [
  "---",
  "status: new",
  "todos:",
  '  - text: "Renew the permit"',
  "    status: parked",
  "---",
  "Some body prose, unrelated to the todo.",
  "",
].join("\n");

const fmDone = setTodoStatus(fm, { locator: { kind: "frontmatter", index: 0 }, status: "done" });
fmDone
=>
---
status: new
todos:
  - text: "Renew the permit"
    status: done
---
Some body prose, unrelated to the todo.
```

```ts continue
fmDone.endsWith("Some body prose, unrelated to the todo.\n")
=> true

setTodoStatus(fmDone, { locator: { kind: "frontmatter", index: 0 }, status: "open" })
=>
---
status: new
todos:
  - text: "Renew the permit"
---
Some body prose, unrelated to the todo.
```

## An unresolved locator throws, rather than silently editing nothing

```ts
setTodoStatus(memo("plain text, no todo here\n"), { locator: { kind: "body", line: 5 }, status: "done" })
=> throws TodoLocatorNotFoundError

setTodoStatus(memo("{% todo %}Only one{% /todo %}\n"), { locator: { kind: "body", line: 5, nth: 2 }, status: "done" })
=> throws TodoLocatorNotFoundError

setTodoStatus("status: new\n", { locator: { kind: "frontmatter", index: 0 }, status: "done" })
=> throws TodoLocatorNotFoundError
```

## Round-trip: the result reports the new status at the same locator

`setTodoStatus` numbers the tag with the same `assignLocators` pass the
collector uses, so a locator read from `extractCardTodos` before the write
still finds the same todo after it.

```ts continue
const before = extractCardTodos({ relPath: CARD, content: memo("{% todo %}Buy milk{% /todo %}\n"), ctx }).items[0]!;
before.status
=> open

const updated = setTodoStatus(memo("{% todo %}Buy milk{% /todo %}\n"), { locator: before.locator, status: "done" });
extractCardTodos({ relPath: CARD, content: updated, ctx }).items[0]!.status
=> done
```

```ts cleanup
await box.cleanup();
```
