# `collections.query` — the `todo-view` card's data source

Route-tier doctests for `docs/plans/todo-collection.md` Track 4.
`collections.query` names a collection and hands it a `CollectionQuery`; the
runner (`core/collection/run.ts`) owns what a scope, a reference pass, and a
grouping mean, so the router's own job is small: validate the input, refuse a
path that leaves the box, and pass the box's clock down.

It replaces `todos.list`, whose glob-from-`cardPath` rule is now `here`:
a `todo-view` card passes its own **directory**, and the scope glob follows
from that.

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

/** Every item the result carries, matching or context, as `text` strings. */
function texts(res) {
  return res.groups.flatMap((g) => g.rows.flatMap((r) => r.items.map((i) => i.text))).sort();
}

/** `path (via)` per row, across every group. */
function rows(res) {
  return res.groups.flatMap((g) => g.rows.map((r) => `${r.card.path} (${r.via})`)).sort();
}

const OPEN = { status: ["open"] };
```

## `here` resolution: a subdirectory's view sees only its own subtree

A todo under `_content/projects/kitchen/` and one at the box root both exist.
`here` is the `todo-view` card's directory, and the glob it resolves to is
echoed back on `result.query` — so a subtree-scoped plate is recognizable as
one.

```ts
const box = await makeTmpBox({ git: true });
await box.write("_content/root.memo.card", memo('{% todo %}Root-level todo{% /todo %}\n'));
await box.write("_content/projects/kitchen/notes.memo.card", memo('{% todo %}Pick a countertop{% /todo %}\n'));
box.commitAll("seed");

const res = await caller(box.root).collections.query({
  collection: "todos",
  query: { here: "_content/projects/kitchen", params: OPEN },
});

res.query.glob
=> _content/projects/kitchen/**

JSON.stringify(texts(res))
=> ["Pick a countertop"]
```

An explicit `glob` overrides the one `here` implies, while `here` keeps
deciding what a *reference* points into.

```ts continue
const explicit = await caller(box.root).collections.query({
  collection: "todos",
  query: { here: "_content/projects/kitchen", glob: "_content/root.memo.card", params: OPEN },
});

JSON.stringify(texts(explicit))
=> ["Root-level todo"]
```

`here: ""` is the box. Nothing is outside it, so the reference pass does not
run and does not have to be turned off.

```ts continue
const boxWide = await caller(box.root).collections.query({
  collection: "todos",
  query: { here: "", params: OPEN },
});

JSON.stringify([boxWide.query.glob, boxWide.query.includeReferring])
=> ["**/*.card",false]

JSON.stringify(texts(boxWide))
=> ["Pick a countertop","Root-level todo"]
```

```ts cleanup
await box.cleanup();
```

## A card as `here`: the card summary's one-file query

A card's todo summary (`docs/plans/todos-ui.md`, Track 4) asks about the card
itself with no reference pass. `here` is a literal path, so a card whose name
holds glob metacharacters still scopes to itself — and only itself, not a
sibling that a `[2]` character class would otherwise match.

```ts
const box = await makeTmpBox({ git: true });
await box.write("_content/porch/Draft [2].memo.card", memo('{% todo %}Sand the rail{% /todo %}\n{% todo status="done" %}Buy primer{% /todo %}\n'));
await box.write("_content/porch/Draft 2.memo.card", memo('{% todo %}Sibling todo{% /todo %}\n'));
box.commitAll("seed");

const one = await caller(box.root).collections.query({
  collection: "todos",
  query: { here: "_content/porch/Draft [2].memo.card", includeReferring: false, params: { status: ["open", "parked", "done", "dropped"] } },
});

JSON.stringify(texts(one))
=> ["Buy primer","Sand the rail"]

JSON.stringify([one.reduction.open, one.reduction.done])
=> [1,1]
```

```ts cleanup
await box.cleanup();
```

## Referring scope: a todo elsewhere that links into `here`

A card outside the glob contributes only the items that point into `here`,
marked `via: "reference"` so the list can say where they came from. Turning
`includeReferring` off restores the subtree-only scan.

```ts
const box = await makeTmpBox({ git: true });
await box.write("_content/projects/kitchen/notes.memo.card", memo('{% todo %}Pick a countertop{% /todo %}\n'));
await box.write(
  "_content/errands.memo.card",
  memo(
    '{% todo %}Hardware run{% /todo %} — for [the kitchen](/_content/projects/kitchen)\n\n' +
    '{% todo %}Water the beans{% /todo %}\n'
  )
);
box.commitAll("seed");
const c = caller(box.root);

const withRefs = await c.collections.query({
  collection: "todos",
  query: { here: "_content/projects/kitchen", params: OPEN },
});

JSON.stringify(rows(withRefs))
=> ["_content/errands.memo.card (reference)","_content/projects/kitchen/notes.memo.card (scope)"]

// "Water the beans" points nowhere near the kitchen, so it stays out.
JSON.stringify(texts(withRefs))
=> ["Hardware run","Pick a countertop"]

const scopeOnly = await c.collections.query({
  collection: "todos",
  query: { here: "_content/projects/kitchen", includeReferring: false, params: OPEN },
});

JSON.stringify(rows(scopeOnly))
=> ["_content/projects/kitchen/notes.memo.card (scope)"]
```

```ts cleanup
await box.cleanup();
```

## Params, and the two groupings

`params` is the collection's own zod schema (`TodoParamsSchema`), so the
filter means what `bbx query todos --status` means. The reduction counts
every in-scope item whether or not it matched — a hidden done todo still
shows up as "1 done".

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

const openOnly = await c.collections.query({
  collection: "todos",
  query: { here: "_content/a.memo.card", params: { status: ["open"] } },
});

JSON.stringify(openOnly.groups.flatMap((g) => g.rows.flatMap((r) => r.items.map((i) => i.id))).sort())
=> ["t-escalated","t-quiet"]

JSON.stringify([openOnly.reduction.open, openOnly.reduction.done, openOnly.reduction.escalated])
=> [2,1,1]

// `onPlate` narrows further, excluding the quiet one.
const onPlate = await c.collections.query({
  collection: "todos",
  query: { here: "_content/a.memo.card", params: { status: ["open"], onPlate: true } },
});

JSON.stringify(onPlate.groups.flatMap((g) => g.rows.flatMap((r) => r.items.map((i) => i.id))))
=> ["t-escalated"]
```

`place` is one group — position is the meaning, and the renderer nests
sections and parents inside each row. `plate` splits the same rows across the
plate states, and a state with no items is absent rather than empty.

```ts continue
const place = await c.collections.query({
  collection: "todos",
  query: { here: "_content/a.memo.card", group: "place", params: { status: ["open"] } },
});

JSON.stringify(place.groups.map((g) => `${g.key}:${g.label}`))
=> ["place:By place"]

const plate = await c.collections.query({
  collection: "todos",
  query: { here: "_content/a.memo.card", group: "plate", params: { status: ["open"] } },
});

JSON.stringify(plate.groups.map((g) => `${g.key}=${String(g.reduction.open)}`))
=> ["escalated=1","quiet=1"]
```

```ts cleanup
await box.cleanup();
```

## `scope`: boxholder by default, agent follow-ups only with `scope: "all"`

An agent-assigned todo never reaches a reduction or a row under the default
`scope: "boxholder"` — not merely hidden, but never counted, which is what
lets a header's number and the list's rows agree by construction.

```ts
const box = await makeTmpBox({ git: true });
await box.write(
  "_content/a.memo.card",
  memo(
    '{% todo %}Boxholder{% /todo %}\n\n' +
    '{% todo assigned="agent" by="agent" created="2026-07-01" %}Agent follow-up{% /todo %}\n'
  )
);
box.commitAll("seed");
const c = caller(box.root);

const defaultScope = await c.collections.query({
  collection: "todos",
  query: { here: "_content/a.memo.card", params: { status: ["open"] } },
});

JSON.stringify(texts(defaultScope))
=> ["Boxholder"]

defaultScope.reduction.open
=> 1

const allScope = await c.collections.query({
  collection: "todos",
  query: { here: "_content/a.memo.card", params: { status: ["open"], scope: "all" } },
});

JSON.stringify(texts(allScope).sort())
=> ["Agent follow-up","Boxholder"]

allScope.reduction.open
=> 2
```

```ts cleanup
await box.cleanup();
```

## Guards: a scope that leaves the box is refused at the input boundary

`here` and `glob` both fail closed, rather than reaching the glob package
(where an absolute pattern bypasses `cwd` entirely) or surfacing as an opaque
500.

```ts
const box = await makeTmpBox({ git: true });
const c = caller(box.root);

async function refused(query) {
  try {
    await c.collections.query({ collection: "todos", query });
    return "SUCCEEDED";
  } catch (e) {
    return e.code ?? e.name;
  }
}

await refused({ here: "../elsewhere", params: OPEN })
=> BAD_REQUEST

await refused({ here: "", glob: "/etc/**", params: OPEN })
=> BAD_REQUEST

await refused({ here: "", glob: "../**/*.card", params: OPEN })
=> BAD_REQUEST
```

An unknown collection name is refused the same way — it never reaches a
server-side lookup.

```ts continue
async function refusedCollection(collection) {
  try {
    await c.collections.query({ collection, query: { here: "", params: OPEN } });
    return "SUCCEEDED";
  } catch (e) {
    return e.code ?? e.name;
  }
}

await refusedCollection("questions")
=> BAD_REQUEST
```

```ts cleanup
await box.cleanup();
```

## Issues pass through untouched

A card that fails to parse still contributes a visible issue alongside
whatever todos the rest of the scan found — the router never swallows one.

```ts
const box = await makeTmpBox({ git: true });
await box.write("_content/good.memo.card", memo('{% todo %}A fine todo{% /todo %}\n'));
// An unterminated tag fails Markdoc parse outright.
await box.write("_content/bad.memo.card", memo('{% todo %}Unterminated tag\n'));
box.commitAll("seed");

const res = await caller(box.root).collections.query({
  collection: "todos",
  query: { here: "", params: OPEN },
});

JSON.stringify(texts(res))
=> ["A fine todo"]

res.issues.length > 0
=> true

res.issues[0].path
=> _content/bad.memo.card
```

```ts cleanup
await box.cleanup();
```
