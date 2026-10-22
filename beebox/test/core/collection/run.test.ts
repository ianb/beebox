// # The collection runner (`core/collection/run.ts`)
//
// Filesystem-tier tests for `docs/plans/todo-collection.md` Track 3.
// `runCollection` does the five stages in order — scope, extract, derive,
// reference scope, then match/reduce/group — over a fixture box, against the
// one collection that exists today (`core/todo/collection.ts`).
//
// The runner holds no state: the caller hands it a `DeriveContext`, which is
// the only place a clock can enter.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { runCollection } from "../../../src/core/collection/run/core.js";
import { todoCollection, TodoParamsSchema, type DerivedTodo, type TodoParams, type TodoReduction } from "../../../src/core/todo/collection.js";
import type { CollectionQuery, CollectionResult } from "../../../src/core/collection/types.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { formatTodoLocation } from "../../../src/core/todo/collect-types.js";

const box = await makeTmpBox();
await box.write("_config/box.json", JSON.stringify({ timezone: "America/Chicago" }));

// America/Chicago is UTC-5 in July, so this is 2026-07-28 box-local.
const NOW = new Date("2026-07-28T12:00:00.000Z");
const CTX = { now: NOW, timeZone: "America/Chicago", since: null };

function doc(title: string, body: string): string {
  return `---\ntitle: ${title}\n---\n${body}`;
}

const KITCHEN = "_content/projects/Kitchen";

await box.write(`${KITCHEN}/Plan.doc.card`, doc("Cabinet plan", [
  "## Cabinets",
  "",
  '- {% todo status="done" %}Strip the doors{% /todo %}',
  "  - {% todo %}Sand the frames{% /todo %} — Tomas has the sander",
  "",
  "## Floor",
  "",
  '- {% todo status="done" %}Measure the room{% /todo %}',
  "- {% todo %}Order tile{% /todo %} — from [the supplies list](Supplies.doc.card)",
  '- {% todo status="parked" %}Replace the window{% /todo %}',
  "",
].join("\n")));

await box.write(`${KITCHEN}/Supplies.doc.card`, doc("Supplies", [
  '{% todo start="2026-07-27" due="2026-08-10" %}Reorder the grout{% /todo %}',
  "",
  '{% todo status="dropped" %}Second sander{% /todo %}',
  "",
].join("\n")));

// Outside the Kitchen subtree, and pointing into it three different ways.
await box.write("_content/projects/Garden/Notes.doc.card", doc("Garden notes", [
  "## Hardware",
  "",
  "- {% todo %}Hardware run{% /todo %}",
  "  - {% todo %}Grab grout for [the kitchen](/_content/projects/Kitchen){% /todo %}",
  "  - {% todo %}Ask about [the cabinet plan](/_content/projects/Kitchen/Plan.doc.card){% /todo %}",
  "  - {% todo %}Check [the supplies list](/_content/projects/Kitchen/Supplies.doc.card){% /todo %}",
  "- {% todo %}Water the beans{% /todo %}",
  "",
].join("\n")));

// No todos at all: it is read, contributes nothing, and never earns a row.
await box.write("_content/Inbox.doc.card", doc("Inbox", "Nothing pending here.\n"));

function params(raw: Record<string, unknown>): TodoParams {
  return TodoParamsSchema.parse(raw);
}

/** Each group with its rows and items reduced to the fields a reader sees; `*` marks a matching item. */
function render(result: CollectionResult<DerivedTodo, TodoReduction>) {
  return result.groups.map((group) => ({
    key: group.key,
    label: group.label,
    reduction: group.reduction,
    rows: group.rows.map((row) => ({
      path: row.card.path,
      via: row.via,
      reduction: row.reduction,
      items: row.items.map((item) => `${item.matching ? "*" : "-"} [${item.sectionPath.join("/")}] ${item.text}`),
    })),
  }));
}

async function run(query: CollectionQuery<TodoParams>): Promise<CollectionResult<DerivedTodo, TodoReduction>> {
  return runCollection(box.root, { def: todoCollection, query, deriveCtx: CTX });
}

// ## `here` decides the scope, and the result echoes what it ran
//
// A directory scopes to its subtree and turns the reference pass on; a card path
// scopes to that one card; the box turns the reference pass off, because nothing
// is outside it to refer in.
void test("A directory scopes to its subtree and turns the reference pass on; a card pat...", async (t) => {
  const dirQuery = await run({ here: KITCHEN, params: params({}) });
  t.check(dirQuery.query, {
    here: "_content/projects/Kitchen",
    glob: "_content/projects/Kitchen/**",
    includeReferring: true,
    group: "place",
  });

  const cardQuery = await run({ here: `${KITCHEN}/Plan.doc.card`, params: params({}) });
  t.check(cardQuery.query, {
    here: "_content/projects/Kitchen/Plan.doc.card",
    glob: "_content/projects/Kitchen/Plan.doc.card",
    includeReferring: true,
    group: "place",
  });

  const boxQuery = await run({ here: "", params: params({}) });
  t.check(boxQuery.query, { here: "", glob: "**/*.card", includeReferring: false, group: "place" });

  // The scope is a directory-vs-card decision about the path's SHAPE, not a
  // `stat` — a query resolves the same way whether or not the path exists.
  //
  // ## Rows, reductions, and the ancestor a filter would otherwise orphan
  //
  // Default params are `status: ["open", "parked"]`. The reduction still counts
  // every in-scope item, so a card's header can say "3 of 6" while showing three;
  // and a matching item whose parent is filtered out keeps that parent as marked
  // context rather than floating loose.

  t.check(render(await run({ here: `${KITCHEN}/Plan.doc.card`, includeReferring: false, params: params({}) })), [
    {
      key: "place",
      label: "By place",
      reduction: { open: 2, done: 0, dropped: 0, parked: 1, onPlate: 2, escalated: 0, next: null },
      rows: [
        {
          path: "_content/projects/Kitchen/Plan.doc.card",
          via: "scope",
          reduction: { open: 2, done: 2, dropped: 0, parked: 1, onPlate: 2, escalated: 0, next: null },
          items: [
            "- [Cabinets] Strip the doors",
            "* [Cabinets] Sand the frames",
            "* [Floor] Order tile",
            "* [Floor] Replace the window",
          ],
        },
      ],
    },
  ]);

  // "Strip the doors" is `done`: it is not in the group's reduction and is marked
  // `-`, but it is shown so its open child reads in context. The row's reduction
  // counts all five.
  //
  // Sections come back as data, one entry per distinct section path on the card,
  // each reduced over its own items.

  const planRow = (await run({ here: `${KITCHEN}/Plan.doc.card`, includeReferring: false, params: params({}) })).groups[0]?.rows[0];
  t.check(planRow?.sections.map((s) => [s.path.join("/"), s.reduction.open, s.reduction.done]), [["Cabinets", 1, 1], ["Floor", 1, 1]]);

  t.check(planRow?.card.title, "Cabinet plan");

  // ## Params filter what matches, never what counts

  t.check(render(await run({ here: `${KITCHEN}/Plan.doc.card`, includeReferring: false, params: params({ status: ["done"] }) })), [
    {
      key: "place",
      label: "By place",
      reduction: { open: 0, done: 2, dropped: 0, parked: 0, onPlate: 0, escalated: 0, next: null },
      rows: [
        {
          path: "_content/projects/Kitchen/Plan.doc.card",
          via: "scope",
          reduction: { open: 2, done: 2, dropped: 0, parked: 1, onPlate: 2, escalated: 0, next: null },
          items: ["* [Cabinets] Strip the doors", "* [Floor] Measure the room"],
        },
      ],
    },
  ]);

  // A card with no matching item has no row — `Inbox.doc.card` is read on a
  // box-wide scan and never appears.

  const boxWide = await run({ here: "", params: params({}) });
  t.check(boxWide.groups[0]?.rows.map((r) => r.card.path), [
    "_content/projects/Garden/Notes.doc.card",
    "_content/projects/Kitchen/Plan.doc.card",
    "_content/projects/Kitchen/Supplies.doc.card",
  ]);

  // ## Groupings
  //
  // `place` is one group, because position is the meaning and the renderer nests
  // sections and parents inside each row. `plate` is the six plate states, in the
  // list's order, with rows formed again inside each group.

  const byPlate = await run({ here: KITCHEN, includeReferring: false, group: "status", params: params({ status: ["open", "parked", "done", "dropped"] }) });
  t.check(byPlate.groups.map((g) => ({ key: g.key, label: g.label, reduction: g.reduction, cards: g.rows.map((r) => r.card.title) })), [
    { key: "on-plate", label: "Now", reduction: { open: 3, done: 0, dropped: 0, parked: 0, onPlate: 3, escalated: 0, next: "2026-07-27" }, cards: ["Cabinet plan", "Supplies"] },
    { key: "parked", label: "Parked", reduction: { open: 0, done: 0, dropped: 0, parked: 1, onPlate: 0, escalated: 0, next: null }, cards: ["Cabinet plan"] },
    { key: "done", label: "Done", reduction: { open: 0, done: 2, dropped: 0, parked: 0, onPlate: 0, escalated: 0, next: null }, cards: ["Cabinet plan"] },
    { key: "dropped", label: "Dropped", reduction: { open: 0, done: 0, dropped: 1, parked: 0, onPlate: 0, escalated: 0, next: null }, cards: ["Supplies"] },
  ]);

  // An empty plate state is not an empty group: it is absent.
  //
  // ## `next` is the earliest date an open todo carries

  const supplies = await run({ here: `${KITCHEN}/Supplies.doc.card`, includeReferring: false, params: params({}) });
  t.check(supplies.reduction, { open: 1, done: 0, dropped: 1, parked: 0, onPlate: 1, escalated: 0, next: "2026-07-27" });

  // `2026-07-27` is the resolved `start`, which lands before the `due`.
  //
  // ## `since` drives `stirring`, and the caller owns the baseline
  //
  // The review sweep keeps its own baseline file; everything else passes `null`,
  // and then nothing is stirring.

  const stirringQuery = { here: `${KITCHEN}/Supplies.doc.card`, includeReferring: false, params: params({}) };
  const quiet = await runCollection(box.root, { def: todoCollection, query: stirringQuery, deriveCtx: CTX });
  t.check(quiet.groups[0]?.rows[0]?.items.map((i) => [i.text, i.stirring]), [["Reorder the grout", false]]);

  const since = Date.UTC(2026, 6, 20);
  const stirred = await runCollection(box.root, { def: todoCollection, query: stirringQuery, deriveCtx: { ...CTX, since } });
  t.check(stirred.groups[0]?.rows[0]?.items.map((i) => [i.text, i.stirring]), [["Reorder the grout", true]]);

});

void test("Reference scope: todos elsewhere that point at this place", async (t) => {
  // ## Reference scope: todos elsewhere that point at this place
  //
  // A card inside the glob contributes ALL its items, `via: "scope"`. A card
  // outside contributes only the items whose refs point into `here`, plus those
  // items' ancestors, `via: "reference"`.
  //
  // Rows are ordered `via` first and path second: the place's own cards, then the
  // cards that point into it. A referring card's path has nothing to do with the
  // place, so letting it sort among the project's own cards — `Garden/Notes`
  // ahead of `Kitchen/Plan` in a query about the kitchen — would put somebody
  // else's list at the top of this one.

  t.check(render(await run({ here: KITCHEN, params: params({}) })), [
    {
      key: "place",
      label: "By place",
      reduction: { open: 7, done: 0, dropped: 0, parked: 1, onPlate: 7, escalated: 0, next: "2026-07-27" },
      rows: [
        {
          path: "_content/projects/Kitchen/Plan.doc.card",
          via: "scope",
          reduction: { open: 2, done: 2, dropped: 0, parked: 1, onPlate: 2, escalated: 0, next: null },
          items: [
            "- [Cabinets] Strip the doors",
            "* [Cabinets] Sand the frames",
            "* [Floor] Order tile",
            "* [Floor] Replace the window",
          ],
        },
        {
          path: "_content/projects/Kitchen/Supplies.doc.card",
          via: "scope",
          reduction: { open: 1, done: 0, dropped: 1, parked: 0, onPlate: 1, escalated: 0, next: "2026-07-27" },
          items: ["* [] Reorder the grout"],
        },
        {
          path: "_content/projects/Garden/Notes.doc.card",
          via: "reference",
          reduction: { open: 4, done: 0, dropped: 0, parked: 0, onPlate: 4, escalated: 0, next: null },
          items: [
            "* [Hardware] Hardware run",
            "* [Hardware] Grab grout for the kitchen",
            "* [Hardware] Ask about the cabinet plan",
            "* [Hardware] Check the supplies list",
          ],
        },
      ],
    },
  ]);

  // "Water the beans" is in the same card and points nowhere near the kitchen, so
  // it is not in scope at all — not even as a non-matching row entry. "Hardware
  // run" refers to nothing either, but it comes along as the ancestor of three
  // items that do.
  //
  // A card path has no subtree: only the ref naming that exact card matches, and
  // a ref to its sibling does not.

  const toPlan = await run({ here: `${KITCHEN}/Plan.doc.card`, params: params({}) });
  const referring = toPlan.groups[0]?.rows.filter((r) => r.via === "reference") ?? [];
  t.check(referring.map((r) => r.items.map((i) => `${i.matching ? "*" : "-"}${i.text}`)), [["*Hardware run", "*Ask about the cabinet plan"]]);

  // `includeReferring: false` restores the subtree-only scan — the escape hatch
  // for the cost below.

  const noRefs = await run({ here: KITCHEN, includeReferring: false, params: params({}) });
  t.check(noRefs.groups[0]?.rows.map((r) => ({ path: r.card.path, via: r.via })), [
    { path: "_content/projects/Kitchen/Plan.doc.card", via: "scope" },
    { path: "_content/projects/Kitchen/Supplies.doc.card", via: "scope" },
  ]);

  // A card inside the glob that ALSO refers into `here` stays `via: "scope"` and
  // keeps all of its items — the reference pass never sees it.

  t.check(
    (await run({ here: KITCHEN, params: params({}) })).groups[0]?.rows
      .filter((r) => r.card.path.startsWith(`${KITCHEN}/`))
      .map((r) => r.via),
    ["scope", "scope"],
  );

});

void test("Issues, duplicate ids, shared lines, unsafe globs and cost", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // ## Issues travel beside the result, never instead of it
  //
  // A card in scope that cannot be read contributes an issue and no items; the
  // rest of the query is unaffected.

  await box.write(`${KITCHEN}/Broken.doc.card`, "---\ntitle: 7\n---\n{% todo %}Lost{% /todo %}\n");
  const withIssue = await run({ here: KITCHEN, includeReferring: false, params: params({}) });
  t.check(withIssue.issues.map((i) => [i.kind, i.path]), [["load", "_content/projects/Kitchen/Broken.doc.card"]]);

  t.check(withIssue.groups[0]?.rows.map((r) => r.card.path), [
    "_content/projects/Kitchen/Plan.doc.card",
    "_content/projects/Kitchen/Supplies.doc.card",
  ]);

  // Some problems only appear once every card has been read. A collection may
  // declare a `crossCardIssues` pass for those; todos use it for a duplicate `id`,
  // which hides nothing but does break the one handle an agent has for naming a
  // single todo.

  await box.write(`${KITCHEN}/Dup.doc.card`, doc("Dup", '{% todo id="grout" %}One{% /todo %}\n\n{% todo id="grout" %}Two{% /todo %}\n'));
  const dup = await run({ here: KITCHEN, includeReferring: false, params: params({}) });
  t.check(dup.issues.filter((i) => i.kind === "duplicate-id").map((i) => i.message), [
    'duplicate todo id "grout" used at: _content/projects/Kitchen/Dup.doc.card:4, _content/projects/Kitchen/Dup.doc.card:6',
  ]);

  // The reference pass is deliberately quieter: a card outside the scope that
  // fails to parse is skipped without an issue, because an unparseable card cannot
  // be shown to refer to anything, and a project-scoped view should not fill up
  // with the rest of the box's problems.
  //
  // ## Two todos on one line are two rows' worth of item, not one
  //
  // A row keys its items by identity, so a line carrying two todos has to give up
  // two identities or lose one of them. It does: the first keeps the plain
  // `path:line`, the second carries `#2`, and the item nested under the line hangs
  // off the todo that owns it — the last one written before the nested list.

  await box.write(`${KITCHEN}/Move.doc.card`, doc("Move", [
    "- {% todo %}Appraise{% /todo %} — ask Marisol {% todo %}Insure{% /todo %} — before the move",
    "  - {% todo %}Get the policy number{% /todo %}",
    "",
  ].join("\n")));
  const move = await run({ here: `${KITCHEN}/Move.doc.card`, includeReferring: false, params: params({}) });
  const moveRow = move.groups[0]?.rows[0];
  t.check(
    moveRow?.items.map((i) => ({
      location: formatTodoLocation(i),
      text: i.text,
      parent: i.parent === null ? null : formatTodoLocation({ path: i.path, locator: i.parent }),
    })),
    [
      { location: "_content/projects/Kitchen/Move.doc.card:4", text: "Appraise", parent: null },
      { location: "_content/projects/Kitchen/Move.doc.card:4#2", text: "Insure", parent: null },
      {
        location: "_content/projects/Kitchen/Move.doc.card:5",
        text: "Get the policy number",
        parent: "_content/projects/Kitchen/Move.doc.card:4#2",
      },
    ],
  );

  // The reduction counted all three before this fix too — it reads the flat item
  // list. It was the row that dropped one, which is what the web list, `bbx query`
  // and `bbx todos` all render.

  t.check(moveRow?.reduction, { open: 3, done: 0, dropped: 0, parked: 0, onPlate: 3, escalated: 0, next: null });

  // ## A glob that could leave the box is refused before anything is read

  await t.checkThrows(async () => (await run({ here: "", glob: "../**/*.card", params: params({}) })), "UnsafeGlobError");

  // ## Cost
  //
  // There is no reverse index, so `includeReferring` reads every card in the box.
  // A card whose text cannot hold a todo is skipped without a parse
  // (`mayHaveItem`), which is what keeps it survivable until indexing exists.
  //
  // On this fixture the reference pass roughly triples the query — about 17 ms
  // against 5 ms subtree-only, on the machine this was written on, for a box of
  // six cards. The ratio is the number that travels; the absolute times do not,
  // which is why they are prose here and not an assertion. On a real box the
  // reference pass reads every card, so the ratio grows with the box and not with
  // the scope.

  const t0 = performance.now();
  await run({ here: KITCHEN, includeReferring: false, params: params({}) });
  const subtreeMs = performance.now() - t0;
  const t1 = performance.now();
  await run({ here: KITCHEN, params: params({}) });
  const referringMs = performance.now() - t1;
  t.check({ subtreeMs, referringMs }, { subtreeMs: any(Number).between(0, Infinity), referringMs: any(Number).between(0, Infinity) });
});

// ## The scope prefilter: a card whose text can't hold a todo is skipped without a parse
//
// 200 cards, three carrying real todos, one broken card that mentions "todo" (so
// it earns a parse attempt and reports an issue), and one broken card that
// doesn't (so `mayHaveItem` skips it before anything can fail). Only the three
// todo-bearing cards contribute rows, and only the parsed-and-failed card
// contributes an issue — a card `mayHaveItem` skips is invisible even when its
// frontmatter is broken (the plan's narrowed visible-invalid guarantee).
void test("200 cards, three carrying real todos, one broken card that mentions \"todo\" (s...", async (t) => {
  t.teardown(async () => {
    try {
      await prefilterBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const prefilterBox = await makeTmpBox();

  for (let i = 0; i < 195; i++) {
    await prefilterBox.write(`_content/plain-${String(i)}.doc.card`, doc(`Plain ${String(i)}`, "Nothing to see here.\n"));
  }
  await prefilterBox.write("_content/one.doc.card", doc("One", "{% todo %}First{% /todo %}\n"));
  await prefilterBox.write("_content/two.doc.card", doc("Two", "{% todo %}Second{% /todo %}\n"));
  await prefilterBox.write("_content/three.doc.card", doc("Three", "{% todo %}Third{% /todo %}\n"));
  // Broken frontmatter (title must be a string) but mentions "todo", so it must
  // still be parsed and reported.
  await prefilterBox.write("_content/broken-with-todo.doc.card", "---\ntitle: 7\n---\ntodo mentioned but none written\n");
  // Broken frontmatter and no mention of "todo" anywhere — skipped before the
  // parse that would have failed ever runs.
  await prefilterBox.write("_content/broken-without.doc.card", "---\ntitle: 7\n---\nNothing relevant here.\n");

  const prefiltered = await runCollection(prefilterBox.root, {
    def: todoCollection,
    query: { here: "", params: params({}) },
    deriveCtx: CTX,
  });

  t.check(prefiltered.groups[0]?.rows.map((r) => r.card.path), [
    "_content/one.doc.card",
    "_content/three.doc.card",
    "_content/two.doc.card",
  ]);

  t.check(prefiltered.issues.map((i) => [i.kind, i.path]), [["load", "_content/broken-with-todo.doc.card"]]);
});
