# The collection runner (`core/collection/run.ts`)

Filesystem-tier doctests for `docs/plans/todo-collection.md` Track 3.
`runCollection` does the five stages in order — scope, extract, derive,
reference scope, then match/reduce/group — over a fixture box, against the
one collection that exists today (`core/todo/collection.ts`).

The runner holds no state: the caller hands it a `DeriveContext`, which is
the only place a clock can enter.

```ts setup
import { runCollection } from "../../src/core/collection/run.js";
import { todoCollection, TodoParamsSchema } from "../../src/core/todo/collection.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

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

function params(raw: Record<string, unknown>): ReturnType<typeof TodoParamsSchema.parse> {
  return TodoParamsSchema.parse(raw);
}

/** `group / card (via) reduction` then one line per item, indented, `*` for a matching item. */
function render(result: Awaited<ReturnType<typeof runCollection>>): string {
  const lines: string[] = [];
  for (const group of result.groups) {
    lines.push(`# ${group.key} "${group.label}" ${count(group.reduction)}`);
    for (const row of group.rows) {
      lines.push(`  ${row.card.path} (${row.via}) ${count(row.reduction)}`);
      for (const item of row.items) {
        lines.push(`    ${item.matching ? "*" : "-"} [${item.sectionPath.join("/")}] ${item.text}`);
      }
    }
  }
  return lines.join("\n");
}

function count(reduction: unknown): string {
  return JSON.stringify(reduction);
}

async function run(query: Record<string, unknown>): Promise<Awaited<ReturnType<typeof runCollection>>> {
  return runCollection(box.root, { def: todoCollection, query, deriveCtx: CTX });
}
```

## `here` decides the scope, and the result echoes what it ran

A directory scopes to its subtree and turns the reference pass on; a card path
scopes to that one card; the box turns the reference pass off, because nothing
is outside it to refer in.

```ts
const dirQuery = await run({ here: KITCHEN, params: params({}) });
JSON.stringify(dirQuery.query)
=> {"here":"_content/projects/Kitchen","glob":"_content/projects/Kitchen/**","includeReferring":true,"group":"place"}

const cardQuery = await run({ here: `${KITCHEN}/Plan.doc.card`, params: params({}) });
JSON.stringify(cardQuery.query)
=> {"here":"_content/projects/Kitchen/Plan.doc.card","glob":"_content/projects/Kitchen/Plan.doc.card","includeReferring":true,"group":"place"}

const boxQuery = await run({ here: "", params: params({}) });
JSON.stringify(boxQuery.query)
=> {"here":"","glob":"**/*.card","includeReferring":false,"group":"place"}
```

The scope is a directory-vs-card decision about the path's SHAPE, not a
`stat` — a query resolves the same way whether or not the path exists.

## Rows, reductions, and the ancestor a filter would otherwise orphan

Default params are `status: ["open", "parked"]`. The reduction still counts
every in-scope item, so a card's header can say "3 of 6" while showing three;
and a matching item whose parent is filtered out keeps that parent as marked
context rather than floating loose.

```ts continue
render(await run({ here: `${KITCHEN}/Plan.doc.card`, includeReferring: false, params: params({}) }))
=>
# place "By place" {"open":2,"done":0,"dropped":0,"parked":1,"onPlate":2,"escalated":0,"next":null}
  _content/projects/Kitchen/Plan.doc.card (scope) {"open":2,"done":2,"dropped":0,"parked":1,"onPlate":2,"escalated":0,"next":null}
    - [Cabinets] Strip the doors
    * [Cabinets] Sand the frames
    * [Floor] Order tile
    * [Floor] Replace the window
```

"Strip the doors" is `done`: it is not in the group's reduction and is marked
`-`, but it is shown so its open child reads in context. The row's reduction
counts all five.

Sections come back as data, one entry per distinct section path on the card,
each reduced over its own items.

```ts continue
const planRow = (await run({ here: `${KITCHEN}/Plan.doc.card`, includeReferring: false, params: params({}) })).groups[0].rows[0];
JSON.stringify(planRow.sections.map((s) => [s.path.join("/"), s.reduction.open, s.reduction.done]))
=> [["Cabinets",1,1],["Floor",1,1]]

planRow.card.title
=> Cabinet plan
```

## Params filter what matches, never what counts

```ts continue
render(await run({ here: `${KITCHEN}/Plan.doc.card`, includeReferring: false, params: params({ status: ["done"] }) }))
=>
# place "By place" {"open":0,"done":2,"dropped":0,"parked":0,"onPlate":0,"escalated":0,"next":null}
  _content/projects/Kitchen/Plan.doc.card (scope) {"open":2,"done":2,"dropped":0,"parked":1,"onPlate":2,"escalated":0,"next":null}
    * [Cabinets] Strip the doors
    * [Floor] Measure the room
```

A card with no matching item has no row — `Inbox.doc.card` is read on a
box-wide scan and never appears.

```ts continue
const boxWide = await run({ here: "", params: params({}) });
boxWide.groups[0].rows.map((r) => r.card.path).join("\n")
=>
_content/projects/Garden/Notes.doc.card
_content/projects/Kitchen/Plan.doc.card
_content/projects/Kitchen/Supplies.doc.card
```

## Groupings

`place` is one group, because position is the meaning and the renderer nests
sections and parents inside each row. `plate` is the six plate states, in the
list's order, with rows formed again inside each group.

```ts continue
const byPlate = await run({ here: KITCHEN, includeReferring: false, group: "plate", params: params({ status: ["open", "parked", "done", "dropped"] }) });
byPlate.groups.map((g) => `${g.key} "${g.label}" ${String(g.reduction.open + g.reduction.done + g.reduction.dropped + g.reduction.parked)}`).join("\n")
=>
on-plate "On the plate" 3
parked "Parked" 1
done "Done" 2
dropped "Dropped" 1

byPlate.groups.map((g) => `${g.key}: ${g.rows.map((r) => r.card.title).join(", ")}`).join("\n")
=>
on-plate: Cabinet plan, Supplies
parked: Cabinet plan
done: Cabinet plan
dropped: Supplies
```

An empty plate state is not an empty group: it is absent.

## `next` is the earliest date an open todo carries

```ts continue
const supplies = await run({ here: `${KITCHEN}/Supplies.doc.card`, includeReferring: false, params: params({}) });
JSON.stringify(supplies.reduction)
=> {"open":1,"done":0,"dropped":1,"parked":0,"onPlate":1,"escalated":0,"next":"2026-07-27"}
```

`2026-07-27` is the resolved `start`, which lands before the `due`.

## `since` drives `stirring`, and the caller owns the baseline

The review sweep keeps its own baseline file; everything else passes `null`,
and then nothing is stirring.

```ts continue
const stirringQuery = { here: `${KITCHEN}/Supplies.doc.card`, includeReferring: false, params: params({}) };
const quiet = await runCollection(box.root, { def: todoCollection, query: stirringQuery, deriveCtx: CTX });
JSON.stringify(quiet.groups[0].rows[0].items.map((i) => [i.text, i.stirring]))
=> [["Reorder the grout",false]]

const since = Date.UTC(2026, 6, 20);
const stirred = await runCollection(box.root, { def: todoCollection, query: stirringQuery, deriveCtx: { ...CTX, since } });
JSON.stringify(stirred.groups[0].rows[0].items.map((i) => [i.text, i.stirring]))
=> [["Reorder the grout",true]]
```

## Reference scope: todos elsewhere that point at this place

A card inside the glob contributes ALL its items, `via: "scope"`. A card
outside contributes only the items whose refs point into `here`, plus those
items' ancestors, `via: "reference"`.

```ts continue
render(await run({ here: KITCHEN, params: params({}) }))
=>
# place "By place" {"open":7,"done":0,"dropped":0,"parked":1,"onPlate":7,"escalated":0,"next":"2026-07-27"}
  _content/projects/Garden/Notes.doc.card (reference) {"open":4,"done":0,"dropped":0,"parked":0,"onPlate":4,"escalated":0,"next":null}
    * [Hardware] Hardware run
    * [Hardware] Grab grout for the kitchen
    * [Hardware] Ask about the cabinet plan
    * [Hardware] Check the supplies list
  _content/projects/Kitchen/Plan.doc.card (scope) {"open":2,"done":2,"dropped":0,"parked":1,"onPlate":2,"escalated":0,"next":null}
    - [Cabinets] Strip the doors
    * [Cabinets] Sand the frames
    * [Floor] Order tile
    * [Floor] Replace the window
  _content/projects/Kitchen/Supplies.doc.card (scope) {"open":1,"done":0,"dropped":1,"parked":0,"onPlate":1,"escalated":0,"next":"2026-07-27"}
    * [] Reorder the grout
```

"Water the beans" is in the same card and points nowhere near the kitchen, so
it is not in scope at all — not even as a non-matching row entry. "Hardware
run" refers to nothing either, but it comes along as the ancestor of three
items that do.

A card path has no subtree: only the ref naming that exact card matches, and
a ref to its sibling does not.

```ts continue
const toPlan = await run({ here: `${KITCHEN}/Plan.doc.card`, params: params({}) });
const referring = toPlan.groups[0].rows.filter((r) => r.via === "reference");
JSON.stringify(referring.map((r) => r.items.map((i) => `${i.matching ? "*" : "-"}${i.text}`)))
=> [["*Hardware run","*Ask about the cabinet plan"]]
```

`includeReferring: false` restores the subtree-only scan — the escape hatch
for the cost below.

```ts continue
const noRefs = await run({ here: KITCHEN, includeReferring: false, params: params({}) });
noRefs.groups[0].rows.map((r) => `${r.card.path} (${r.via})`).join("\n")
=>
_content/projects/Kitchen/Plan.doc.card (scope)
_content/projects/Kitchen/Supplies.doc.card (scope)
```

A card inside the glob that ALSO refers into `here` stays `via: "scope"` and
keeps all of its items — the reference pass never sees it.

```ts continue
JSON.stringify(
  (await run({ here: KITCHEN, params: params({}) })).groups[0].rows
    .filter((r) => r.card.path.startsWith(`${KITCHEN}/`))
    .map((r) => r.via)
)
=> ["scope","scope"]
```

## Issues travel beside the result, never instead of it

A card in scope that cannot be read contributes an issue and no items; the
rest of the query is unaffected.

```ts continue
await box.write(`${KITCHEN}/Broken.doc.card`, "---\ntitle: 7\n---\n{% todo %}Lost{% /todo %}\n");
const withIssue = await run({ here: KITCHEN, includeReferring: false, params: params({}) });
JSON.stringify(withIssue.issues.map((i) => [i.kind, i.path]))
=> [["load","_content/projects/Kitchen/Broken.doc.card"]]

withIssue.groups[0].rows.length
=> 2
```

The reference pass is deliberately quieter: a card outside the scope that
fails to parse is skipped without an issue, because an unparseable card cannot
be shown to refer to anything, and a project-scoped view should not fill up
with the rest of the box's problems.

## A glob that could leave the box is refused before anything is read

```ts continue
await run({ here: "", glob: "../**/*.card", params: params({}) })
=> throws UnsafeGlobError
```

## Cost

There is no reverse index, so `includeReferring` reads every card in the box.
A card whose text cannot hold a todo is skipped without a parse
(`mayHaveItem`), which is what keeps it survivable until indexing exists.

On this fixture the reference pass roughly triples the query — about 17 ms
against 5 ms subtree-only, on the machine this was written on, for a box of
six cards. The ratio is the number that travels; the absolute times do not,
which is why they are prose here and not an assertion. On a real box the
reference pass reads every card, so the ratio grows with the box and not with
the scope.

```ts continue
const t0 = performance.now();
await run({ here: KITCHEN, includeReferring: false, params: params({}) });
const subtreeMs = performance.now() - t0;
const t1 = performance.now();
await run({ here: KITCHEN, params: params({}) });
const referringMs = performance.now() - t1;
print(`subtree-only ${subtreeMs.toFixed(0)} ms, with referring ${referringMs.toFixed(0)} ms`);
[subtreeMs, referringMs].every((ms) => ms >= 0)
=> «*»
true
```

```ts cleanup
await box.cleanup();
```
