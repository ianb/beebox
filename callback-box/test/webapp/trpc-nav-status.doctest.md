# status.navStatus

`status.navStatus` is the query the app nav mounts on **every** page, so it
returns only the two badge counts the nav renders and computes only those. It
does not touch `getSystemState` — no `git status`, no `git log`, no inbox scan,
no full card load of every question — which is what makes it cheap enough to
sit on the critical path of every page load. `status.status` (the dashboard's
payload) keeps its fuller shape.

```ts setup
import { statusRouter } from "../../src/webapp/trpc/routers/status.js";
import { collectTodos } from "../../src/core/todo/collect.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

function caller(box) {
  const ctx = {
    boxRoot: box.root,
    boxSlug: "t",
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
    services: {},
    user: null,
    authed: true,
    isOwner: true,
  };
  return statusRouter.createCaller(ctx);
}

function question(status) {
  return `---
status: ${status}
prompt: Pick one
input:
  type: text
directive: Use the answer
---
`;
}
```

## An empty box counts zero of each

The questions directory doesn't exist yet in a fresh box — a missing directory
is zero pending questions, not an error.

```ts
const box = await makeTmpBox({ git: true });
JSON.stringify(await caller(box).navStatus())
=> {"counts":{"pendingQuestions":0,"onPlateTodos":0}}
```

```ts cleanup
await box.cleanup();
```

## Only `pending` questions count, at any depth

Answered and dismissed questions are resolved; they don't belong on the badge.
Questions filed in a subdirectory still count — the nav badge is box-wide.

```ts
const box = await makeTmpBox({ git: true });
await box.write("box/questions/One.question.card", question("pending"));
await box.write("box/questions/Two.question.card", question("answered"));
await box.write("box/questions/Three.question.card", question("dismissed"));
await box.write("box/questions/inbox-review/Four.question.card", question("pending"));

const counts = (await caller(box).navStatus()).counts;
counts.pendingQuestions
=> 2
```

## Todos on the plate are counted; done and future ones are not

`onPlateTodos` is `escalated` (past due) plus `on-plate` (started, or undated) —
the same derivation `cb todos` uses, reached through the shared collector. A
`done` todo and one that hasn't started yet are both off the plate.

```ts continue
await box.write(
  "box/notes/Plans.memo.card",
  `---
created: 2026-01-01T00:00:00Z
todos:
  - text: Undated, so on the plate
  - text: Already finished
    status: done
  - text: Starts next century
    start: "2199-01-01"
---
Body.
`,
);

const withTodos = (await caller(box).navStatus()).counts;
JSON.stringify(withTodos)
=> {"pendingQuestions":2,"onPlateTodos":1}
```

## The count agrees with the full collector

The badge count is a fast path (parallel reads, and cards whose text can't
mention a todo are skipped without parsing). It must still agree, card for
card, with what `collectTodos` reports — including a `{% todo %}` captured in a
card body rather than frontmatter.

```ts continue
await box.write(
  "box/notes/Body.memo.card",
  `---
created: 2026-01-01T00:00:00Z
title: Body capture
---
{% todo %}Written in the body{% /todo %}
`,
);

const collected = await collectTodos(box.root);
const fromCollector = collected.todos.filter(
  (t) => t.plateState === "escalated" || t.plateState === "on-plate",
).length;
const fromBadge = (await caller(box).navStatus()).counts.onPlateTodos;

`${fromCollector} == ${fromBadge}`
=> 2 == 2
```

```ts cleanup
await box.cleanup();
```
