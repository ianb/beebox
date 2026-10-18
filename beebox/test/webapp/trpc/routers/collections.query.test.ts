// # `collections.query` — the `todo-view` card's data source
//
// Route-tier doctests for `docs/plans/todo-collection.md` Track 4.
// `collections.query` names a collection and hands it a `CollectionQuery`; the
// runner (`core/collection/run.ts`) owns what a scope, a reference pass, and a
// grouping mean, so the router's own job is small: validate the input, refuse a
// path that leaves the box, and pass the box's clock down.
//
// It replaces `todos.list`, whose glob-from-`cardPath` rule is now `here`:
// a `todo-view` card passes its own **directory**, and the scope glob follows
// from that.

import { test } from "tap";
import "agent-doctest/tap";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import type { z } from "zod";
import type { TodoParamsSchema } from "../../../../src/core/todo/collection.js";
import type { TodoQueryResult } from "../../../../src/core/todo/query.js";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";

function caller(boxRoot: string) {
  const ctx: TrpcContext = trpcContext({ boxRoot, isAuthenticatedOwner: true });
  return appRouter.createCaller(ctx);
}

process.env.BBX_TIME = "2026-07-28T12:00:00.000Z";

function doc(body: string) {
  return `---\ntitle: Notes\n---\n${body}`;
}

/** Every item the result carries, matching or context, as `text` strings. */
function texts(res: TodoQueryResult) {
  return res.groups.flatMap((g) => g.rows.flatMap((r) => r.items.map((i) => i.text))).toSorted();
}

/** `path (via)` per row, across every group. */
function rows(res: TodoQueryResult) {
  return res.groups.flatMap((g) => g.rows.map((r) => `${r.card.path} (${r.via})`)).toSorted();
}

const OPEN: z.input<typeof TodoParamsSchema> = { status: ["open"] };
type QueryInput = Parameters<ReturnType<typeof caller>["collections"]["query"]>[0]["query"];

// ## `here` resolution: a subdirectory's view sees only its own subtree
//
// A todo under `_content/projects/kitchen/` and one at the box root both exist.
// `here` is the `todo-view` card's directory, and the glob it resolves to is
// echoed back on `result.query` — so a subtree-scoped plate is recognizable as
// one.
void test("A todo under content/projects/kitchen/ and one at the box root both exist.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L56
  const box = await makeTmpBox({ git: true });
  await box.write("_content/root.doc.card", doc("{% todo %}Root-level todo{% /todo %}\n"));
  await box.write("_content/projects/kitchen/notes.doc.card", doc("{% todo %}Pick a countertop{% /todo %}\n"));
  box.commitAll("seed");

  // doctest:L61
  const res = await caller(box.root).collections.query({
    collection: "todos",
    query: { here: "_content/projects/kitchen", params: OPEN },
  });

  // doctest:L66
  t.check(res.query.glob, "_content/projects/kitchen/**");

  // doctest:L69
  t.check(texts(res), [
    "Pick a countertop",
  ]);

  // An explicit `glob` overrides the one `here` implies, while `here` keeps
  // deciding what a *reference* points into.

  // doctest:L77
  const explicit = await caller(box.root).collections.query({
    collection: "todos",
    query: { here: "_content/projects/kitchen", glob: "_content/root.doc.card", params: OPEN },
  });

  // doctest:L82
  t.check(texts(explicit), [
    "Root-level todo",
  ]);

  // `here: ""` is the box. Nothing is outside it, so the reference pass does not
  // run and does not have to be turned off.

  // doctest:L90
  const boxWide = await caller(box.root).collections.query({
    collection: "todos",
    query: { here: "", params: OPEN },
  });

  // doctest:L95
  t.check([boxWide.query.glob, boxWide.query.includeReferring], [
    "**/*.card",
    false,
  ]);

  // doctest:L98
  t.check(texts(boxWide), [
    "Pick a countertop",
    "Root-level todo",
  ]);
});

// ## A card as `here`: the card summary's one-file query
//
// A card's todo summary (`docs/plans/todos-ui.md`, Track 4) asks about the card
// itself with no reference pass. `here` is a literal path, so a card whose name
// holds glob metacharacters still scopes to itself — and only itself, not a
// sibling that a `[2]` character class would otherwise match.
void test("A card's todo summary (docs/plans/todos-ui.md, Track 4) asks about the card i...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L114
  const box = await makeTmpBox({ git: true });
  await box.write("_content/porch/Draft [2].doc.card", doc('{% todo %}Sand the rail{% /todo %}\n{% todo status="done" %}Buy primer{% /todo %}\n'));
  await box.write("_content/porch/Draft 2.doc.card", doc("{% todo %}Sibling todo{% /todo %}\n"));
  box.commitAll("seed");

  // doctest:L119
  const one = await caller(box.root).collections.query({
    collection: "todos",
    query: { here: "_content/porch/Draft [2].doc.card", includeReferring: false, params: { status: ["open", "parked", "done", "dropped"] } },
  });

  // doctest:L124
  t.check(texts(one), [
    "Buy primer",
    "Sand the rail",
  ]);

  // doctest:L127
  t.check([one.reduction.open, one.reduction.done], [
    1,
    1,
  ]);
});

// ## Referring scope: a todo elsewhere that links into `here`
//
// A card outside the glob contributes only the items that point into `here`,
// marked `via: "reference"` so the list can say where they came from. Turning
// `includeReferring` off restores the subtree-only scan.
void test("A card outside the glob contributes only the items that point into here, mark...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L142
  const box = await makeTmpBox({ git: true });
  await box.write("_content/projects/kitchen/notes.doc.card", doc("{% todo %}Pick a countertop{% /todo %}\n"));
  await box.write(
    "_content/errands.doc.card",
    doc(
      "{% todo %}Hardware run{% /todo %} — for [the kitchen](/_content/projects/kitchen)\n\n" +
      "{% todo %}Water the beans{% /todo %}\n"
    )
  );
  box.commitAll("seed");
  const c = caller(box.root);

  // doctest:L154
  const withRefs = await c.collections.query({
    collection: "todos",
    query: { here: "_content/projects/kitchen", params: OPEN },
  });

  // doctest:L159
  t.check(rows(withRefs), [
    "_content/errands.doc.card (reference)",
    "_content/projects/kitchen/notes.doc.card (scope)",
  ]);

  // doctest:L162
  await t.checkText(
    // "Water the beans" points nowhere near the kitchen, so it stays out.
    JSON.stringify(texts(withRefs)),
    "[\"Hardware run\",\"Pick a countertop\"]",
  );

  // doctest:L166
  const scopeOnly = await c.collections.query({
    collection: "todos",
    query: { here: "_content/projects/kitchen", includeReferring: false, params: OPEN },
  });

  // doctest:L171
  t.check(rows(scopeOnly), [
    "_content/projects/kitchen/notes.doc.card (scope)",
  ]);
});

// ## Params, and the two groupings
//
// `params` is the collection's own zod schema (`TodoParamsSchema`), so the
// filter means what `bbx query todos --status` means. The reduction counts
// every in-scope item whether or not it matched — a hidden done todo still
// shows up as "1 done".
void test("params is the collection's own zod schema (TodoParamsSchema), so the filter m...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L187
  const box = await makeTmpBox({ git: true });
  await box.write("_config/box.json", JSON.stringify({ timezone: "America/Chicago" }));
  await box.write(
    "_content/a.doc.card",
    doc(
      '{% todo id="t-done" status="done" %}Already finished{% /todo %}\n\n' +
      '{% todo id="t-escalated" due="2026-07-01" %}Overdue thing{% /todo %}\n\n' +
      '{% todo id="t-quiet" start="2026-09-01" %}Not yet{% /todo %}\n'
    )
  );
  box.commitAll("seed");
  const c = caller(box.root);

  // doctest:L200
  const openOnly = await c.collections.query({
    collection: "todos",
    query: { here: "_content/a.doc.card", params: { status: ["open"] } },
  });

  // doctest:L205
  t.check(openOnly.groups.flatMap((g) => g.rows.flatMap((r) => r.items.map((i) => i.id))).toSorted(), [
    "t-escalated",
    "t-quiet",
  ]);

  // doctest:L208
  t.check([openOnly.reduction.open, openOnly.reduction.done, openOnly.reduction.escalated], [
    2,
    1,
    1,
  ]);

  // doctest:L211
  // `onPlate` narrows further, excluding the quiet one.
  const onPlate = await c.collections.query({
    collection: "todos",
    query: { here: "_content/a.doc.card", params: { status: ["open"], onPlate: true } },
  });

  // doctest:L217
  t.check(onPlate.groups.flatMap((g) => g.rows.flatMap((r) => r.items.map((i) => i.id))), [
    "t-escalated",
  ]);

  // `place` is one group — position is the meaning, and the renderer nests
  // sections and parents inside each row. `plate` splits the same rows across the
  // plate states, and a state with no items is absent rather than empty.

  // doctest:L226
  const place = await c.collections.query({
    collection: "todos",
    query: { here: "_content/a.doc.card", group: "place", params: { status: ["open"] } },
  });

  // doctest:L231
  t.check(place.groups.map((g) => `${g.key}:${g.label}`), [
    "place:By place",
  ]);

  // doctest:L234
  const plate = await c.collections.query({
    collection: "todos",
    query: { here: "_content/a.doc.card", group: "plate", params: { status: ["open"] } },
  });

  // doctest:L239
  t.check(plate.groups.map((g) => `${g.key}=${String(g.reduction.open)}`), [
    "escalated=1",
    "quiet=1",
  ]);
});

// ## `scope`: boxholder by default, agent follow-ups only with `scope: "all"`
//
// An agent-assigned todo never reaches a reduction or a row under the default
// `scope: "boxholder"` — not merely hidden, but never counted, which is what
// lets a header's number and the list's rows agree by construction.
void test("An agent-assigned todo never reaches a reduction or a row under the default s...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L254
  const box = await makeTmpBox({ git: true });
  await box.write(
    "_content/a.doc.card",
    doc(
      "{% todo %}Boxholder{% /todo %}\n\n" +
      '{% todo assigned="agent" by="agent" created="2026-07-01" %}Agent follow-up{% /todo %}\n'
    )
  );
  box.commitAll("seed");
  const c = caller(box.root);

  // doctest:L265
  const defaultScope = await c.collections.query({
    collection: "todos",
    query: { here: "_content/a.doc.card", params: { status: ["open"] } },
  });

  // doctest:L270
  t.check(texts(defaultScope), [
    "Boxholder",
  ]);

  // doctest:L273
  t.check(defaultScope.reduction.open, 1);

  // doctest:L276
  const allScope = await c.collections.query({
    collection: "todos",
    query: { here: "_content/a.doc.card", params: { status: ["open"], scope: "all" } },
  });

  // doctest:L281
  t.check(texts(allScope).toSorted(), [
    "Agent follow-up",
    "Boxholder",
  ]);

  // doctest:L284
  t.check(allScope.reduction.open, 2);
});

// ## Guards: a scope that leaves the box is refused at the input boundary
//
// `here` and `glob` both fail closed, rather than reaching the glob package
// (where an absolute pattern bypasses `cwd` entirely) or surfacing as an opaque
// 500.
void test("here and glob both fail closed, rather than reaching the glob package (where...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L299
  const box = await makeTmpBox({ git: true });
  const c = caller(box.root);

  // doctest:L302
  async function refused(query: QueryInput) {
    try {
      await c.collections.query({ collection: "todos", query });
      return "SUCCEEDED";
    } catch (e) {
      return e instanceof TRPCError ? e.code : e instanceof Error ? e.name : String(e);
    }
  }

  // doctest:L311
  t.check(await refused({ here: "../elsewhere", params: OPEN }), "BAD_REQUEST");

  // doctest:L314
  t.check(await refused({ here: "", glob: "/etc/**", params: OPEN }), "BAD_REQUEST");

  // doctest:L317
  t.check(await refused({ here: "", glob: "../**/*.card", params: OPEN }), "BAD_REQUEST");

  // An unknown collection name is refused the same way — it never reaches a
  // server-side lookup.

  // doctest:L325
  async function refusedCollection(collection: string) {
    try {
      // A name outside the declared collections, as an untrusted client could send it; the server must refuse it.
      const request: Parameters<typeof c.collections.query>[0] = JSON.parse(JSON.stringify({ collection, query: { here: "", params: OPEN } }));
      await c.collections.query(request);
      return "SUCCEEDED";
    } catch (e) {
      return e instanceof TRPCError ? e.code : e instanceof Error ? e.name : String(e);
    }
  }

  // doctest:L336
  t.check(await refusedCollection("questions"), "BAD_REQUEST");
});

// ## Issues pass through untouched
//
// A card that fails to parse still contributes a visible issue alongside
// whatever todos the rest of the scan found — the router never swallows one.
void test("A card that fails to parse still contributes a visible issue alongside whatev...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L350
  const box = await makeTmpBox({ git: true });
  await box.write("_content/good.doc.card", doc("{% todo %}A fine todo{% /todo %}\n"));
  // An unterminated tag fails Markdoc parse outright.
  await box.write("_content/bad.doc.card", doc("{% todo %}Unterminated tag\n"));
  box.commitAll("seed");

  // doctest:L356
  const res = await caller(box.root).collections.query({
    collection: "todos",
    query: { here: "", params: OPEN },
  });

  // doctest:L361
  t.check(texts(res), [
    "A fine todo",
  ]);

  // doctest:L364
  await t.checkText(res.issues.length > 0, "true");

  // doctest:L367
  t.check(res.issues[0]?.path, "_content/bad.doc.card");
});
