# `todo-review-job` card schema

The compact brief the wakeup sweep queues for the reactor
(`core/todo/review-sweep.ts`). Each item is deliberately terse: a locator, the
todo's text, whichever date drove it into its set — and, since
`docs/plans/todo-collection.md` Track 4, where it was written.

`card` and `section` are OPTIONAL. A job card queued before those fields
existed is still sitting in some box's `_bookkeeping/jobs/`, and it has to
keep validating.

```ts setup
import { TodoReviewJobSchema, createTodoReviewJobTemplate } from "../../src/schemas/todo-review-job.js";
import { parseCardText } from "../../src/core/card-io.js";

const schemas = new Map([["todo-review-job", TodoReviewJobSchema]]);

function parse(card) {
  return parseCardText(card, { source: "job.todo-review-job.card", schemas, type: "todo-review-job" });
}
```

## An item carrying `card` and `section` round-trips

```ts
const card = createTodoReviewJobTemplate({
  escalated: [{
    locator: "_content/projects/Porch/Plan.doc.card:8",
    text: "Order lumber",
    detail: "due 2026-07-01",
    card: "Porch rebuild",
    section: "Build › Decking",
  }],
  stirring: [],
  stale: [],
});

const parsed = parse(card);
JSON.stringify(parsed.fields.escalated[0])
=> {"locator":"_content/projects/Porch/Plan.doc.card:8","text":"Order lumber","detail":"due 2026-07-01","card":"Porch rebuild","section":"Build › Decking"}
```

## An older item without them still validates

A todo written under no heading omits `section` rather than carrying an empty
one, so the same shape covers both "queued before the fields existed" and
"there was nothing to say".

```ts continue
const older = parse([
  "---",
  "status: pending",
  "source: todo-review",
  "priority: normal",
  "description: 'Todo review sweep: 1 escalated.'",
  "escalated:",
  "  - locator: store/a.memo.card:5",
  "    text: An older item",
  "    detail: due 2026-07-01",
  "stirring: []",
  "stale: []",
  "---",
  "",
].join("\n"));

JSON.stringify(older.fields.escalated[0])
=> {"locator":"store/a.memo.card:5","text":"An older item","detail":"due 2026-07-01"}
```
