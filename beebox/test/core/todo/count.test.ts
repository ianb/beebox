// # The plate badge counts the boxholder's todos (`core/todo/count.ts`)
//
// `countOnPlateTodos` is the number behind the nav's plate badge. It counts open
// todos that are on the plate now — past `due`, or started, or undated — and
// only the ones the boxholder owns. An `assigned="agent"` todo is the agent's
// own follow-up: real work with a real owner, but not the person's, so it never
// inflates their badge.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { countOnPlateTodos } from "../../../src/core/todo/count.js";
import { runTodoQuery } from "../../../src/core/todo/query.js";
import { isBoxholderTodo, TODO_AGENT } from "../../../src/shared/todo-model.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

/** Every todo in the box, whatever its status or `assigned` — the collection runner, box-wide. */
async function collectTodos(boxRoot: string) {
  const result = await runTodoQuery(boxRoot, {
    query: { here: "", params: { status: ["open", "done", "dropped", "parked"], scope: "all" } },
    since: null,
  });
  return { todos: result.groups.flatMap((g) => g.rows).flatMap((r) => r.items), issues: result.issues };
}

const DOC_FM = "title: Kitchen\ncontains: Notes on the kitchen remodel.\n";
const doc = (body: string): string => `---\n${DOC_FM}---\n${body}`;

process.env.BBX_TIME = "2026-07-28T12:00:00.000Z";
const box = await makeTmpBox();

// ## The boxholder's todos are counted; the agent's are not
//
// One undated todo for the boxholder, one for the agent, and one the agent
// wrote but left to the boxholder (`by` is provenance, `assigned` is ownership,
// and only ownership decides the badge).
void test("One undated todo for the boxholder, one for the agent, and one the agent wrot...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L38
  await box.write("_content/notes/Plate.doc.card", doc(`
{% todo %}Call the vet back{% /todo %}

{% todo assigned="agent" by="agent" created="2026-07-28" %}
Second pass over the recipe cards
{% /todo %}

{% todo by="agent" created="2026-07-28" %}
Decide whether to keep the old kiln notes
{% /todo %}
`));

  // doctest:L50
  t.check(await countOnPlateTodos(box.root), 2);

  // All three are still collected and still on the plate; the count is the only
  // thing that discriminates.

  // doctest:L58
  const collected = await collectTodos(box.root);
  t.check(collected.todos.map((todo) => [todo.text.slice(0, 12), todo.assigned ?? null, todo.plateState]), [
    [
      "Call the vet",
      null,
      "on-plate",
    ],
    [
      "Second pass ",
      "agent",
      "on-plate",
    ],
    [
      "Decide wheth",
      null,
      "on-plate",
    ],
  ]);

  // doctest:L62
  t.check(collected.todos.filter((todo) => !isBoxholderTodo(todo)).map((todo) => todo.text.slice(0, 12)), [
    "Second pass ",
  ]);

  // ## Ownership, not authorship
  //
  // A todo is the boxholder's when `assigned` is absent. `"agent"` is the box
  // agent's; any other name is that person's, so it is off the boxholder's plate.
  // A placeholder such as `"user"` draws a lint warning (`todoAssignedWarning`)
  // because the author meant the boxholder, so it stays the boxholder's.

  // doctest:L74
  t.check(
    [
      isBoxholderTodo({}),
      isBoxholderTodo({ assigned: undefined }),
      isBoxholderTodo({ assigned: TODO_AGENT }),
      isBoxholderTodo({ assigned: "Dana" }),
      isBoxholderTodo({ assigned: "user" }),
      isBoxholderTodo({ assigned: "Me" }),
    ],
    [
    true,
    true,
    false,
    false,
    true,
    true,
  ],
  );

  // ## An agent todo past its due date still stays off the badge
  //
  // Escalation is about the date, not about who is owed the work.

  // doctest:L90
  await box.write("_content/notes/Overdue.doc.card", doc(`
{% todo assigned="agent" by="agent" created="2026-07-01" due="2026-07-02" %}
Re-check the frozen snapshot
{% /todo %}
`));

  // doctest:L96
  t.check(await countOnPlateTodos(box.root), 2);

  // A boxholder todo past due does count, and reads as escalated:

  // doctest:L103
  await box.write("_content/notes/Late.doc.card", doc(`
{% todo due="2026-07-02" %}Renew the parking permit{% /todo %}
`));

  // doctest:L107
  t.check(await countOnPlateTodos(box.root), 3);

  // Ordering follows card path, so `Late.doc.card` precedes `Overdue.doc.card`:

  // doctest:L114
  t.check((await collectTodos(box.root)).todos.filter((todo) => todo.plateState === "escalated").map((todo) => [todo.text.slice(0, 10), todo.assigned ?? null]), [
    [
      "Renew the ",
      null,
    ],
    [
      "Re-check t",
      "agent",
    ],
  ]);
});

// ## The badge equals the plate's boxholder `onPlate` reduction, by construction
//
// Both read the boxholder-scope predicate (`isBoxholderTodo`) — `count.ts`
// applies it directly on its fast path, `runTodoQuery`'s default `scope:
// "boxholder"` applies it as the collection's `inScope` hook — so a fixture with
// one of everything (agent-assigned, parked, quiet, done, escalated) must land
// on the same number both ways.
void test("Both read the boxholder-scope predicate (isBoxholderTodo) — count.ts applies...", async (t) => {
  t.teardown(async () => {
    try {
      await scopeBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L131
  const scopeBox = await makeTmpBox();
  process.env.BBX_TIME = "2026-07-28T12:00:00.000Z";

  // doctest:L134
  await scopeBox.write("_content/notes/Everything.doc.card", doc(`
{% todo %}Undated, on the plate{% /todo %}

{% todo due="2026-07-01" %}Escalated{% /todo %}

{% todo start="2026-09-01" %}Quiet, not yet started{% /todo %}

{% todo status="parked" %}Parked{% /todo %}

{% todo status="done" %}Already finished{% /todo %}

{% todo assigned="agent" by="agent" created="2026-07-28" %}Agent's own follow-up{% /todo %}

{% todo assigned="agent" by="agent" created="2026-07-01" due="2026-07-02" %}
Agent's own follow-up, escalated
{% /todo %}
`));

  const badge = await countOnPlateTodos(scopeBox.root);
  const plate = await runTodoQuery(scopeBox.root, {
    query: { here: "", params: { status: ["open", "done", "dropped", "parked"], scope: "boxholder" } },
    since: null,
  });

  // doctest:L152
  // doctest:L158
  t.check(badge, 2);

  // doctest:L161
  t.check(plate.reduction.onPlate, 2);
});

// ## A todo assigned to another person stays off the badge
//
// The badge counts what the boxholder owes. Dana's todo is still collected, so
// it still renders on its card, but it does not add to the count. The
// placeholder `"user"` todo does.
void test("The badge counts what the boxholder owes.", async (t) => {
  t.teardown(async () => {
    try {
      await othersBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L176
  const othersBox = await makeTmpBox();
  process.env.BBX_TIME = "2026-07-28T12:00:00.000Z";

  // doctest:L179
  await othersBox.write("_content/notes/Others.doc.card", doc(`
{% todo %}Book the hall{% /todo %}

{% todo assigned="Dana" %}Bring the folding chairs{% /todo %}

{% todo assigned="user" %}Water the ferns{% /todo %}
`));

  // doctest:L187
  t.check(await countOnPlateTodos(othersBox.root), 2);

  // doctest:L190
  t.check((await collectTodos(othersBox.root)).todos.map((todo) => todo.assigned ?? null), [
    null,
    "Dana",
    "user",
  ]);
});
