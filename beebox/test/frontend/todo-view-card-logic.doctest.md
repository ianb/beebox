# The `todo-view` list's own logic (`todo-view-card-logic.ts`)

`collections.query` hands the browser a FLAT, locator-ordered item list per
card row, each item naming the todo it nests under and the headings above it.
This module turns that back into what a reader sees — a tree, sections, a
dated strip — and it is pure, so it is tested here rather than through a React
render (`docs/plans/todo-collection.md`, Track 4).

```ts setup
import {
  buildRowSections,
  buildTodoTree,
  datedTodos,
  hereForCard,
  progressOf,
  clampAnnotation,
  needsExpand,
  resolveTodoViewStatusFilter,
  statusFilterWithFinished,
  todoKey,
} from "../../src/frontend/src/components/todo-view-card-logic.js";

/** A row item, with only the fields this module reads. */
function item(line, text, extra) {
  return {
    path: "_content/projects/Porch/Plan.doc.card",
    locator: { kind: "body", line },
    text,
    status: "open",
    sectionPath: [],
    parent: null,
    annotation: "",
    matching: true,
    ...(extra ?? {}),
  };
}

function at(line) {
  return { kind: "body", line };
}

function reduction(extra) {
  return { open: 0, done: 0, dropped: 0, parked: 0, onPlate: 0, escalated: 0, next: null, ...(extra ?? {}) };
}

/** Nested `text > child, child` for a forest. */
function shape(nodes) {
  return nodes
    .map((node) => (node.children.length === 0 ? node.item.text : `${node.item.text} > (${shape(node.children)})`))
    .join(", ");
}
```

## Status filter: what the card asks for, and what the control widens it to

An explicit `status:` list wins; an omitted one defaults to `["open",
"parked"]` — every plate-state group an `open` todo can land in
(escalated/on-plate/quiet) PLUS `parked`. A default of `["open"]` alone made
the `parked` group permanently unreachable on the stock plate: `parked` is a
STATUS, not a plate-state, so it was never included by that default.

```ts
JSON.stringify(resolveTodoViewStatusFilter({}))
=> ["open","parked"]

JSON.stringify(resolveTodoViewStatusFilter({ status: ["done"] }))
=> ["done"]
```

Garbage and empty values fall back to the same default rather than querying
for nothing.

```ts continue
JSON.stringify([
  resolveTodoViewStatusFilter({ status: "not-an-array" }),
  resolveTodoViewStatusFilter({ status: ["not-a-status"] }),
  resolveTodoViewStatusFilter({ status: [] }),
])
=> [["open","parked"],["open","parked"],["open","parked"]]
```

"Show finished" WIDENS the query rather than filtering what came back, so the
reduction and the list keep agreeing about what is in scope. A card that
already lists `done` does not get it twice.

```ts continue
JSON.stringify([
  statusFilterWithFinished(["open", "parked"], false),
  statusFilterWithFinished(["open", "parked"], true),
  statusFilterWithFinished(["done"], true),
])
=> [["open","parked"],["open","parked","done","dropped"],["done","dropped"]]
```

## `here` is the card's directory, not the card

A card path would scope the query to the card itself, which holds no todos.
A card at the box root asks about the box.

```ts
JSON.stringify([
  hereForCard("_content/projects/Porch/Plate.todo-view.card"),
  hereForCard("Plate.todo-view.card"),
])
=> ["_content/projects/Porch",""]
```

## The tree comes back from `parent` links

Items arrive flat and in locator order; each names the todo whose list item
contains it.

```ts
const items = [
  item(5, "Clear the deck"),
  item(6, "Pull the old boards", { parent: at(5) }),
  item(7, "Haul them off", { parent: at(6) }),
  item(9, "Order lumber"),
];

shape(buildTodoTree(items))
=> Clear the deck > (Pull the old boards > (Haul them off)), Order lumber
```

An item whose parent is not in the list is a root rather than a
disappearance — the filter kept a child whose ancestor chain the row did not
reach.

```ts continue
shape(buildTodoTree([item(6, "Pull the old boards", { parent: at(5) })]))
=> Pull the old boards
```

`todoKey` is the identity `parent` names, in both capture forms.

```ts continue
JSON.stringify([
  todoKey(item(5, "x")),
  todoKey({ path: "a.doc.card", locator: { kind: "frontmatter", index: 2 } }),
])
=> ["_content/projects/Porch/Plan.doc.card:5","a.doc.card#todos[2]"]
```

## Sections: unsectioned first, then the card's headings in order

Only a ROOT is placed in a section. A nested todo belongs under its parent,
whatever heading the parent sat beneath — so a child written after a later
heading does not jump out of its own tree.

```ts
const row = {
  card: { path: "_content/projects/Porch/Plan.doc.card", title: "Porch plan" },
  via: "scope",
  reduction: reduction({ open: 3, done: 1 }),
  sections: [
    { path: [], reduction: reduction({ open: 1 }) },
    { path: ["Demolition"], reduction: reduction({ open: 1, done: 2 }) },
    { path: ["Build", "Decking"], reduction: reduction({ open: 1 }) },
  ],
  items: [
    item(4, "Decide the budget"),
    item(7, "Clear the deck", { sectionPath: ["Demolition"] }),
    item(8, "Pull the old boards", { sectionPath: ["Demolition"], parent: at(7) }),
    item(12, "Order lumber", { sectionPath: ["Build", "Decking"] }),
  ],
};

buildRowSections(row).map((s) => `${s.label ?? "—"} [${s.path.join(" › ")}]: ${shape(s.nodes)}`).join("\n")
=>
— []: Decide the budget
Demolition [Demolition]: Clear the deck > (Pull the old boards)
Decking [Build › Decking]: Order lumber
```

A section whose items the filter hid entirely is not rendered as an empty
heading.

```ts continue
buildRowSections({ ...row, items: [item(4, "Decide the budget")] }).map((s) => s.label).join(",")
=>
```

`progressOf` is the "5 of 7" a section head shows: done out of everything that
is not dropped. A dropped todo is neither progress nor outstanding work, so
counting it either way would misstate the section.

```ts continue
JSON.stringify(progressOf(reduction({ open: 2, done: 5, parked: 0, dropped: 3 })))
=> {"done":5,"total":7}
```

## The dated strip

Every open matching item that carries a date, across every row, in date order.
`due` wins over `start` because it is the harder of the two, and the strip
records which one it is showing.

```ts
const result = {
  query: { here: "", glob: "**/*.card", includeReferring: false, group: "place" },
  reduction: reduction(),
  issues: [],
  groups: [
    {
      key: "place",
      label: "By place",
      reduction: reduction(),
      rows: [
        {
          card: { path: "_content/projects/Porch/Plan.doc.card", title: "Porch plan" },
          via: "scope",
          reduction: reduction(),
          sections: [],
          items: [
            item(5, "Order lumber", { due: "2026-10-02" }),
            item(6, "Book the skip", { start: "2026-09-25" }),
            item(7, "Both dates", { start: "2026-09-20", due: "2026-09-22" }),
            item(8, "No date at all"),
            item(9, "Finished", { status: "done", due: "2026-09-01" }),
            item(10, "Only context", { due: "2026-09-02", matching: false }),
          ],
        },
      ],
    },
  ],
};

datedTodos(result).map((d) => `${d.date} ${d.kind} ${d.item.text} (${d.cardTitle})`).join("\n")
=>
2026-09-22 due Both dates (Porch plan)
2026-09-25 start Book the skip (Porch plan)
2026-10-02 due Order lumber (Porch plan)
```

An undated box produces an empty strip, which is how the component knows not
to render one at all.

```ts continue
datedTodos({ ...result, groups: [] }).length
=> 0
```

## A long annotation truncates behind an expand control

```ts
const short = "Tomas has the sander";
const long = `${"a note that keeps going ".repeat(8)}end`;

JSON.stringify([needsExpand(short), needsExpand(long)])
=> [false,true]

clampAnnotation(short)
=> Tomas has the sander

clampAnnotation(long).endsWith("…")
=> true

clampAnnotation(long).length <= 141
=> true
```
