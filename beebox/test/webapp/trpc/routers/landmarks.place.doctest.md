# The place page's view of `landmarks.forDir`

A landmark card renders as the place page: the place's links in tiers, then
each `expand` as a group that says in words what it lists
(docs/plans/landmark-arrival.md, Track C). The page asks `landmarks.forDir`
with `expandsAsGroups: true`; the menus omit the flag and keep today's flat
list. The same payload names the place's arrival target (Track D): the card
that arriving at the place opens.

```ts setup
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { expandLabel } from "../../../../src/core/landmark/expand-label.js";

function caller(boxRoot) {
  const ctx = {
    boxRoot,
    boxSlug: "test",
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
    services: {},
  };
  return appRouter.createCaller(ctx);
}

async function payload(boxRoot: string, input: { dir: string; expandsAsGroups?: boolean }) {
  const { landmark } = await caller(boxRoot).landmarks.forDir(input);
  if (landmark === null) throw new Error(`no landmark in ${input.dir}`);
  return landmark;
}

/** The fields the page reads from each row. */
function rows(links: { ref: string; source: string; exists: boolean; prominence?: string }[]) {
  return links.map((l) => `${l.source}${l.prominence === undefined ? "" : `/${l.prominence}`} ${l.ref}${l.exists ? "" : " (missing)"}`);
}

function groups(gs: { label: string; count: number; children: { ref: string }[] }[]) {
  return gs.map((g) => ({ label: g.label, count: g.count, children: g.children.map((c) => c.ref) }));
}

/**
 * A Lending place: an entry point, a primary card, a nested place, a curated
 * link whose card is gone, an unnamed expand over loan cards, an unnamed expand
 * that matches nothing, and a named group.
 */
async function lendingBox() {
  const box = await makeTmpBox();
  await box.write("_content/lending/Lending.landmark.card", [
    "---",
    "navigation:",
    "  label: Lending",
    "  links:",
    "    - ref: Gone.memo.card",
    "  expand:",
    "    - query: \"*.loan.card\"",
    "    - query: \"**/*.receipt.card\"",
    "    - query: \"*.memo.card\"",
    "      group: Notes",
    "---",
    "",
  ].join("\n"));
  await box.write("_content/lending/Lending_List.memo.card", "---\nprominence: entry-point\n---\n");
  await box.write("_content/lending/Rules.memo.card", "---\nprominence: primary\n---\n");
  await box.write("_content/lending/Drill.loan.card", "---\n---\n");
  await box.write("_content/lending/Stove.loan.card", "---\n---\n");
  await box.write("_content/lending/tools/Tools.landmark.card", "---\nnavigation:\n  label: Tools\n---\n");
  return box;
}
```

## `expandLabel` says what an unnamed expand lists

A single-type glob in the place's own folder, the same glob through every
folder below, and anything else, which is named by its query.

```ts
({ here: expandLabel("*.loan.card"), below: expandLabel("**/*.image.card"), other: expandLabel("2026-*.memo.card") })
=> { here: "Every loan card here", below: "Every image card here and in folders below", other: "Cards matching 2026-*.memo.card" }
```

## With `expandsAsGroups`, every expand is a group

The flat list keeps the curated link (missing, so it stays as a row), the
entry point, the primary card, and the nested place, which is marked
`source: "place"` because its `prominence` cannot tell it from a derived
card. Each unnamed expand becomes its own group, in the order the landmark
lists its expands, under a plain-words label with an exact count; one that matches nothing is still there, with
`count: 0`, so the page can say "None yet".

```ts
const box = await lendingBox();
const page = await payload(box.root, { dir: "_content/lending", expandsAsGroups: true });
({ links: rows(page.links), groups: groups(page.groups) })
=> {
  links: [
    "listed _content/lending/Gone.memo.card (missing)",
    "derived/entry-point _content/lending/Lending_List.memo.card",
    "derived/primary _content/lending/Rules.memo.card",
    "place/background _content/lending/tools/Tools.landmark.card"
  ],
  groups: [
    { label: "Every loan card here", count: 2, children: ["_content/lending/Drill.loan.card", "_content/lending/Stove.loan.card"] },
    { label: "Every receipt card here and in folders below", count: 0, children: [] },
    { label: "Notes", count: 2, children: ["_content/lending/Lending_List.memo.card", "_content/lending/Rules.memo.card"] }
  ]
}
```

## Without the flag, unnamed expands stay in the flat list

The place menu and the chat's link panel read this shape; it is unchanged.

```ts
const box = await lendingBox();
const menu = await payload(box.root, { dir: "_content/lending" });
({ links: rows(menu.links), groups: menu.groups.map((g) => g.label) })
=> {
  links: [
    "listed _content/lending/Gone.memo.card (missing)",
    "derived/entry-point _content/lending/Lending_List.memo.card",
    "derived/primary _content/lending/Rules.memo.card",
    "place/background _content/lending/tools/Tools.landmark.card",
    "expand _content/lending/Drill.loan.card",
    "expand _content/lending/Stove.loan.card"
  ],
  groups: ["Notes"]
}
```

## Arrival opens the single entry point

A place with exactly one entry-point card arrives on that card.

```ts
const box = await lendingBox();
(await payload(box.root, { dir: "_content/lending" })).arrival
=> _content/lending/Lending_List.memo.card
```

## Two entry points, or none, arrive on the landmark card

With two entry points arrival does not guess; with none there is nothing
else to open. Either way it opens the place page.

```ts
const box = await makeTmpBox();
await box.write("_content/swim/Swim.landmark.card", "---\nnavigation:\n  label: Swim\n---\n");
await box.write("_content/swim/Week.memo.card", "---\nprominence: entry-point\n---\n");
await box.write("_content/swim/Meets.memo.card", "---\nprominence: entry-point\n---\n");
await box.write("_content/garden/Garden.landmark.card", "---\nnavigation:\n  label: Garden\n---\n");
({ two: (await payload(box.root, { dir: "_content/swim" })).arrival,
  none: (await payload(box.root, { dir: "_content/garden" })).arrival })
=> { two: "_content/swim/Swim.landmark.card", none: "_content/garden/Garden.landmark.card" }
```

## The root place follows the same rule

The root is the logical directory `""`; its landmark lives under `_content/`.
An entry point inside a nested place belongs to that place, not the root.

```ts
const box = await makeTmpBox();
await box.write("_content/Box.landmark.card", "---\nnavigation:\n  label: test\n---\n");
await box.write("_content/lending/Lending.landmark.card", "---\nnavigation:\n  label: Lending\n---\n");
await box.write("_content/lending/List.memo.card", "---\nprominence: entry-point\n---\n");
const root = await payload(box.root, { dir: "" });
({ dir: root.dir, arrival: root.arrival })
=> { dir: "", arrival: "_content/Box.landmark.card" }
```

## A background place arrives on its landmark card

A `background` landmark's cards are not listed by level, so it has no entry
point to open.

```ts
const box = await makeTmpBox();
await box.write("_content/house/House.landmark.card", "---\nprominence: background\nnavigation:\n  label: Housekeeping\n---\n");
await box.write("_content/house/Log.memo.card", "---\nprominence: entry-point\n---\n");
(await payload(box.root, { dir: "_content/house" })).arrival
=> _content/house/House.landmark.card
```
