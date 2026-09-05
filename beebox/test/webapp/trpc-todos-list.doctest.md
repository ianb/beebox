# `todos.list` — the `todo-view` card's data source

Route-tier doctests for `docs/implemented-plans/todo-annotation.md` Track 4:
`todos.list` is a thin query wrapper over the collector
(`core/todo/collect.ts`). Its glob resolution is one of the plan's two pinned
mechanism details: an explicit `glob` always wins; otherwise a `cardPath`
scopes to that card's own directory subtree (`<dir>/**`); with neither, the
whole box. It also passes through the collector's `issues` untouched — a
card the collector couldn't read must stay visible, never silently dropped.

```ts setup
import { appRouter } from "../../src/webapp/trpc/router.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

function caller(boxRoot) {
  const ctx = {
    boxRoot,
    boxSlug: "test",
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
    services: {},
    user: null,
    authed: true,
    isOwner: true,
  };
  return appRouter.createCaller(ctx);
}

process.env.BBX_TIME = "2026-07-28T12:00:00.000Z";

function memo(body) {
  return `---\nstatus: new\ncreated: 2026-07-01T10:00:00Z\n---\n${body}`;
}
```

## `cardPath`-relative resolution: a subdirectory `todo-view` sees only its own subtree

A todo under `_content/projects/kitchen/` and one at the box root both exist;
querying with `cardPath: "_content/projects/kitchen/plate.todo-view.card"` (no
explicit `glob`) returns only the one inside that directory.

```ts
const box = await makeTmpBox({ git: true });
await box.write("_content/root.memo.card", memo('{% todo %}Root-level todo{% /todo %}\n'));
await box.write("_content/projects/kitchen/notes.memo.card", memo('{% todo %}Pick a countertop{% /todo %}\n'));
box.commitAll("seed");

const res = await caller(box.root).todos.list({
  cardPath: "_content/projects/kitchen/plate.todo-view.card",
});

res.effectiveGlob
=> _content/projects/kitchen/**

JSON.stringify(res.todos.map((t) => t.text))
=> ["Pick a countertop"]
```

```ts cleanup
await box.cleanup();
```

## Explicit `glob` overrides `cardPath`

Passing both `cardPath` and an explicit `glob` uses the glob — the pinned
"explicit glob wins" rule.

```ts
const box = await makeTmpBox({ git: true });
await box.write("_content/root.memo.card", memo('{% todo %}Root-level todo{% /todo %}\n'));
await box.write("_content/projects/kitchen/notes.memo.card", memo('{% todo %}Pick a countertop{% /todo %}\n'));
box.commitAll("seed");

const res = await caller(box.root).todos.list({
  cardPath: "_content/projects/kitchen/plate.todo-view.card",
  glob: "_content/root.memo.card",
});

res.effectiveGlob
=> _content/root.memo.card

JSON.stringify(res.todos.map((t) => t.text))
=> ["Root-level todo"]
```

Neither `cardPath` nor `glob` scans the whole box:

```ts continue
const boxWide = await caller(box.root).todos.list({});
JSON.stringify(boxWide.todos.map((t) => t.text).sort())
=> ["Pick a countertop","Root-level todo"]

boxWide.effectiveGlob
=> **/*.card
```

```ts cleanup
await box.cleanup();
```

## `status` and `onPlate` filters

```ts
const box = await makeTmpBox({ git: true });
await box.write("_config/box.json", JSON.stringify({ timezone: "America/Chicago" }));
await box.write(
  "_content/a.memo.card",
  memo(
    '{% todo id="t-done" status="done" %}Already finished{% /todo %}\n\n' +
    '{% todo id="t-escalated" due="2026-07-01" %}Overdue thing{% /todo %}\n\n' +
    '{% todo id="t-quiet" start="2026-09-01" %}Not yet{% /todo %}\n'
  )
);
box.commitAll("seed");
const c = caller(box.root);

// Default (no status filter): every status comes back.
const all = await c.todos.list({ cardPath: "_content/a.memo.card", glob: "_content/a.memo.card" });
JSON.stringify(all.todos.map((t) => t.id).sort())
=> ["t-done","t-escalated","t-quiet"]

// status: ["open"] excludes the done one.
const openOnly = await c.todos.list({ glob: "_content/a.memo.card", status: ["open"] });
JSON.stringify(openOnly.todos.map((t) => t.id).sort())
=> ["t-escalated","t-quiet"]

// onPlate narrows further to escalated + on-plate, excluding quiet.
const onPlate = await c.todos.list({ glob: "_content/a.memo.card", status: ["open"], onPlate: true });
JSON.stringify(onPlate.todos.map((t) => t.id))
=> ["t-escalated"]
```

```ts cleanup
await box.cleanup();
```

## Issues pass through untouched

A card that fails to parse still contributes a visible issue, alongside
whatever todos the rest of the scan found — `todos.list` never swallows a
collector issue.

```ts
const box = await makeTmpBox({ git: true });
await box.write("_content/good.memo.card", memo('{% todo %}A fine todo{% /todo %}\n'));
// An unterminated tag fails Markdoc parse outright.
await box.write("_content/bad.memo.card", memo('{% todo %}Unterminated tag\n'));
box.commitAll("seed");

const res = await caller(box.root).todos.list({});
JSON.stringify(res.todos.map((t) => t.text))
=> ["A fine todo"]

res.issues.length > 0
=> true

res.issues[0].path
=> _content/bad.memo.card
```

```ts cleanup
await box.cleanup();
```
