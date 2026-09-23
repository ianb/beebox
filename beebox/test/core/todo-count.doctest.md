# The plate badge counts the boxholder's todos (`core/todo/count.ts`)

`countOnPlateTodos` is the number behind the nav's plate badge. It counts open
todos that are on the plate now — past `due`, or started, or undated — and
only the ones the boxholder owns. An `assigned="agent"` todo is the agent's
own follow-up: real work with a real owner, but not the person's, so it never
inflates their badge.

```ts setup
import { countOnPlateTodos } from "../../src/core/todo/count.js";
import { runTodoQuery } from "../../src/core/todo/query.js";
import { isBoxholderTodo, TODO_AGENT } from "../../src/shared/todo-model.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

/** Every todo in the box, whatever its status — the collection runner, box-wide. */
async function collectTodos(boxRoot) {
  const result = await runTodoQuery(boxRoot, {
    query: { here: "", params: { status: ["open", "done", "dropped", "parked"] } },
    since: null,
  });
  return { todos: result.groups.flatMap((g) => g.rows).flatMap((r) => r.items), issues: result.issues };
}

const MEMO_FM = "status: new\ncreated: 2026-07-01T10:00:00Z\n";
const memo = (body: string): string => `---\n${MEMO_FM}---\n${body}`;

process.env.BBX_TIME = "2026-07-28T12:00:00.000Z";
const box = await makeTmpBox();
```

## The boxholder's todos are counted; the agent's are not

One undated todo for the boxholder, one for the agent, and one the agent
wrote but left to the boxholder (`by` is provenance, `assigned` is ownership,
and only ownership decides the badge).

```ts
await box.write("_content/notes/Plate.memo.card", memo(`
{% todo %}Call the vet back{% /todo %}

{% todo assigned="agent" by="agent" created="2026-07-28" %}
Second pass over the recipe cards
{% /todo %}

{% todo by="agent" created="2026-07-28" %}
Decide whether to keep the old kiln notes
{% /todo %}
`));

await countOnPlateTodos(box.root)
=> 2
```

All three are still collected and still on the plate; the count is the only
thing that discriminates.

```ts continue
const collected = await collectTodos(box.root);
JSON.stringify(collected.todos.map((t) => [t.text.slice(0, 12), t.assigned ?? null, t.plateState]))
=> [["Call the vet",null,"on-plate"],["Second pass ","agent","on-plate"],["Decide wheth",null,"on-plate"]]

JSON.stringify(collected.todos.filter((t) => !isBoxholderTodo(t)).map((t) => t.text.slice(0, 12)))
=> ["Second pass "]
```

## Ownership, not authorship

```ts continue
JSON.stringify([
  isBoxholderTodo({}),
  isBoxholderTodo({ assigned: undefined }),
  isBoxholderTodo({ assigned: TODO_AGENT }),
  isBoxholderTodo({ assigned: "someone-else" }),
])
=> [true,true,false,true]
```

## An agent todo past its due date still stays off the badge

Escalation is about the date, not about who is owed the work.

```ts continue
await box.write("_content/notes/Overdue.memo.card", memo(`
{% todo assigned="agent" by="agent" created="2026-07-01" due="2026-07-02" %}
Re-check the frozen snapshot
{% /todo %}
`));

await countOnPlateTodos(box.root)
=> 2
```

A boxholder todo past due does count, and reads as escalated:

```ts continue
await box.write("_content/notes/Late.memo.card", memo(`
{% todo due="2026-07-02" %}Renew the parking permit{% /todo %}
`));

await countOnPlateTodos(box.root)
=> 3
```

Ordering follows card path, so `Late.memo.card` precedes `Overdue.memo.card`:

```ts continue
JSON.stringify((await collectTodos(box.root)).todos.filter((t) => t.plateState === "escalated").map((t) => [t.text.slice(0, 10), t.assigned ?? null]))
=> [["Renew the ",null],["Re-check t","agent"]]
```

```ts cleanup
await box.cleanup();
```
