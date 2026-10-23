// # The `todo-view` list's own logic (`todo-view-card-logic.ts`)
//
// `collections.query` hands the browser a FLAT, locator-ordered item list per
// card row, each item naming the todo it nests under and the headings above it.
// This module turns that back into what a reader sees — a tree, sections, a
// dated strip — and it is pure, so it is tested here rather than through a React
// render (`docs/plans/todo-collection.md`, Track 4).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  buildRowSections,
  buildTodoTree,
  datedTodos,
  hereForCard,
  matchingItemCount,
  plateHeadline,
  progressOf,
  scopeDescription,
  scopeLineText,
  clampAnnotation,
  needsExpand,
  resolveTodoViewStatusFilter,
  statusFilterWithFinished,
  todoKey,
} from "../../src/components/todo-view-card-logic.js";
import type {
  TodoNode,
  TodoReduction,
  TodoResult,
  TodoRow,
  TodoRowItem,
} from "../../src/components/todo-view-card-logic.js";

/** A row item, with only the fields this module reads. */
function item(line: number, { text, ...extra }: Partial<TodoRowItem> & { text: string }): TodoRowItem {
  return {
    path: "_content/projects/Porch/Plan.doc.card",
    locator: { kind: "body", line },
    text,
    status: "open",
    plateState: "quiet",
    stirring: false,
    seeAlso: [],
    refs: [],
    sectionPath: [],
    parent: null,
    annotation: "",
    matching: true,
    ...extra,
  };
}

function at(line: number): TodoRowItem["locator"] {
  return { kind: "body", line };
}

function reduction(extra?: Partial<TodoReduction>): TodoReduction {
  return { open: 0, done: 0, dropped: 0, parked: 0, onPlate: 0, escalated: 0, next: null, ...(extra ?? {}) };
}

/** Nested `text > child, child` for a forest. */
function shape(nodes: TodoNode[]): string {
  return nodes
    .map((node) => (node.children.length === 0 ? node.item.text : `${node.item.text} > (${shape(node.children)})`))
    .join(", ");
}

// ## Status filter: what the card asks for, and what the control widens it to
//
// An explicit `todo-status:` list wins; an omitted one defaults to `["open",
// "parked"]` — every plate-state group an `open` todo can land in
// (escalated/on-plate/quiet) PLUS `parked`. A default of `["open"]` alone made
// the `parked` group permanently unreachable on the stock plate: `parked` is a
// STATUS, not a plate-state, so it was never included by that default.
void test("An explicit todo-status: list wins; an omitted one defaults to [\"open\", \"park...", async (t) => {
  t.check(resolveTodoViewStatusFilter({}), [
    "open",
    "parked",
  ]);

  t.check(resolveTodoViewStatusFilter({ "todo-status": ["done"] }), [
    "done",
  ]);

  // Garbage and empty values fall back to the same default rather than querying
  // for nothing.

  t.check(
    [
      resolveTodoViewStatusFilter({ "todo-status": "not-an-array" }),
      resolveTodoViewStatusFilter({ "todo-status": ["not-a-status"] }),
      resolveTodoViewStatusFilter({ "todo-status": [] }),
    ],
    [
    [
      "open",
      "parked",
    ],
    [
      "open",
      "parked",
    ],
    [
      "open",
      "parked",
    ],
  ],
  );

  // "Show finished" WIDENS the query rather than filtering what came back, so the
  // reduction and the list keep agreeing about what is in scope. A card that
  // already lists `done` does not get it twice.

  t.check(
    [
      statusFilterWithFinished(["open", "parked"], false),
      statusFilterWithFinished(["open", "parked"], true),
      statusFilterWithFinished(["done"], true),
    ],
    [
    [
      "open",
      "parked",
    ],
    [
      "open",
      "parked",
      "done",
      "dropped",
    ],
    [
      "done",
      "dropped",
    ],
  ],
  );
});

// ## `here` is the card's directory, not the card
//
// A card path would scope the query to the card itself, which holds no todos.
// A card at the box root asks about the box.
void test("A card path would scope the query to the card itself, which holds no todos.", async (t) => {
  t.check(
    [
      hereForCard("_content/projects/Porch/Plate.todo-view.card"),
      hereForCard("Plate.todo-view.card"),
    ],
    [
    "_content/projects/Porch",
    "",
  ],
  );
});

// ## The tree comes back from `parent` links
//
// Items arrive flat and in locator order; each names the todo whose list item
// contains it.
void test("Items arrive flat and in locator order; each names the todo whose list item c...", async (t) => {
  const items = [
    item(5, { text: "Clear the deck" }),
    item(6, { text: "Pull the old boards", parent: at(5) }),
    item(7, { text: "Haul them off", parent: at(6) }),
    item(9, { text: "Order lumber" }),
  ];

  t.check(shape(buildTodoTree(items)), "Clear the deck > (Pull the old boards > (Haul them off)), Order lumber");

  // An item whose parent is not in the list is a root rather than a
  // disappearance — the filter kept a child whose ancestor chain the row did not
  // reach.

  t.check(shape(buildTodoTree([item(6, { text: "Pull the old boards", parent: at(5) })])), "Pull the old boards");

  // `todoKey` is the identity `parent` names, in both capture forms.

  t.check(
    [
      todoKey(item(5, { text: "x" })),
      todoKey({ path: "a.doc.card", locator: { kind: "frontmatter", index: 2 } }),
    ],
    [
    "_content/projects/Porch/Plan.doc.card:5",
    "a.doc.card#todos[2]",
  ],
  );

  // A line can hold more than one todo, so a body locator carries `nth` for the
  // second and later ones. The key is also the React key each item renders under,
  // which is why sharing one would not merely confuse the tree: it would make two
  // siblings collide in the list.

  const sameLine = [
    item(5, { text: "Appraise" }),
    item(5, { text: "Insure", locator: { kind: "body", line: 5, nth: 2 } }),
    item(6, { text: "Get the policy number", parent: { kind: "body", line: 5, nth: 2 } }),
  ];

  t.check(sameLine.map((i) => todoKey(i)), [
    "_content/projects/Porch/Plan.doc.card:5",
    "_content/projects/Porch/Plan.doc.card:5#2",
    "_content/projects/Porch/Plan.doc.card:6",
  ]);

  t.check(
    new Set(sameLine.map((i) => todoKey(i))),
    new Set([
      "_content/projects/Porch/Plan.doc.card:5",
      "_content/projects/Porch/Plan.doc.card:5#2",
      "_content/projects/Porch/Plan.doc.card:6",
    ]),
  );

  // `parent` addresses one of the two, not the line, so the nested todo hangs off
  // the todo that owns it.

  t.check(shape(buildTodoTree(sameLine)), "Appraise, Insure > (Get the policy number)");
});

// ## Sections: unsectioned first, then the card's headings in order
//
// Only a ROOT is placed in a section. A nested todo belongs under its parent,
// whatever heading the parent sat beneath — so a child written after a later
// heading does not jump out of its own tree.
void test("Only a ROOT is placed in a section.", async (t) => {
  const row: TodoRow = {
    card: { path: "_content/projects/Porch/Plan.doc.card", title: "Porch plan" },
    via: "scope",
    reduction: reduction({ open: 3, done: 1 }),
    sections: [
      { path: [], reduction: reduction({ open: 1 }) },
      { path: ["Demolition"], reduction: reduction({ open: 1, done: 2 }) },
      { path: ["Build", "Decking"], reduction: reduction({ open: 1 }) },
    ],
    items: [
      item(4, { text: "Decide the budget" }),
      item(7, { text: "Clear the deck", sectionPath: ["Demolition"] }),
      item(8, { text: "Pull the old boards", sectionPath: ["Demolition"], parent: at(7) }),
      item(12, { text: "Order lumber", sectionPath: ["Build", "Decking"] }),
    ],
  };

  t.check(buildRowSections(row).map((s) => ({ label: s.label, path: s.path, nodes: shape(s.nodes) })), [
    { label: null, path: [], nodes: "Decide the budget" },
    { label: "Demolition", path: ["Demolition"], nodes: "Clear the deck > (Pull the old boards)" },
    { label: "Decking", path: ["Build", "Decking"], nodes: "Order lumber" },
  ]);

  // A section whose items the filter hid entirely is not rendered as an empty
  // heading.

  t.check(
    buildRowSections({ ...row, items: [item(4, { text: "Decide the budget" })] }).map((s) => ({ label: s.label, path: s.path, nodes: shape(s.nodes) })),
    [{ label: null, path: [], nodes: "Decide the budget" }],
  );

  // `progressOf` is the "5 of 7" a section head shows: done out of everything that
  // is not dropped. A dropped todo is neither progress nor outstanding work, so
  // counting it either way would misstate the section.

  t.check(progressOf(reduction({ open: 2, done: 5, parked: 0, dropped: 3 })), {
    done: 5,
    total: 7,
  });
});

// ## The plate headline: two numbers off the reduction, one off the matches
//
// `later` is `open` minus `onPlate` — the reduction carries no separate `quiet`
// field because it doesn't need one.
void test("later is open minus onPlate — the reduction carries no separate quiet field b...", async (t) => {
  t.check(plateHeadline(reduction({ open: 7, onPlate: 5 })), {
    onPlate: 5,
    later: 2,
  });

  // The agent count is read off `matching`, not the reduction: an `all`-scope,
  // `assigned: "agent"` query's reduction counts every item scope admitted
  // (boxholder items included), so only the matching subset is the agent's own.

  const agentResult: TodoResult = {
    query: { here: "", glob: "**/*.card", includeReferring: false, group: "place" },
    reduction: reduction({ open: 9 }),
    issues: [],
    groups: [
      {
        key: "place",
        label: "By place",
        reduction: reduction({ open: 2 }),
        rows: [
          {
            card: { path: "_content/a.doc.card", title: "A" },
            via: "scope",
            reduction: reduction({ open: 3 }),
            sections: [],
            items: [
              item(1, { text: "Boxholder's own", matching: false }),
              item(2, { text: "Agent follow-up one" }),
              item(3, { text: "Agent follow-up two" }),
            ],
          },
        ],
      },
    ],
  };

  t.check(matchingItemCount(agentResult), 2);
});

// ## The dated todos
//
// Every open matching item that carries a date, across every row, in date order.
// `due` wins over `start` because it is the harder of the two, and the strip
// records which one it is showing.
void test("Every open matching item that carries a date, across every row, in date order.", async (t) => {
  const result: TodoResult = {
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
              item(5, { text: "Order lumber", due: "2026-10-02" }),
              item(6, { text: "Book the skip", start: "2026-09-25" }),
              item(7, { text: "Both dates", start: "2026-09-20", due: "2026-09-22" }),
              item(8, { text: "No date at all" }),
              item(9, { text: "Finished", status: "done", due: "2026-09-01" }),
              item(10, { text: "Only context", due: "2026-09-02", matching: false }),
            ],
          },
        ],
      },
    ],
  };

  t.check(datedTodos(result).map((d) => ({ date: d.date, kind: d.kind, text: d.item.text, cardTitle: d.cardTitle })), [
    { date: "2026-09-22", kind: "due", text: "Both dates", cardTitle: "Porch plan" },
    { date: "2026-09-25", kind: "start", text: "Book the skip", cardTitle: "Porch plan" },
    { date: "2026-10-02", kind: "due", text: "Order lumber", cardTitle: "Porch plan" },
  ]);

  // An undated box produces an empty strip, which is how the component knows not
  // to render one at all.

  t.check(datedTodos({ ...result, groups: [] }), []);
});

// ## A long annotation truncates behind an expand control
void test("A long annotation truncates behind an expand control", async (t) => {
  const short = "Tomas has the sander";
  const long = `${"a note that keeps going ".repeat(8)}end`;

  t.check([needsExpand(short), needsExpand(long)], [
    false,
    true,
  ]);

  t.check(clampAnnotation(short), "Tomas has the sander");

  t.check(
    clampAnnotation(long),
    "a note that keeps going a note that keeps going a note that keeps going a note that keeps going a note that keeps going a note that keeps go…",
  );
});

// ## The scope line says what the query covers, not its glob
//
// The stock plate card lives in `_content` but is installed with the glob `**`,
// so it covers the whole box. The line names the box, not the folder the card
// sits in and not the pattern.
void test("The stock plate card lives in content but is installed with the glob , so it...", async (t) => {
  t.check(
    [
      scopeDescription({ here: "_content", glob: "**" }),
      scopeDescription({ here: "", glob: "**/*.card" }),
      scopeDescription({ here: "recipes", glob: "recipes/**" }),
      scopeDescription({ here: "_content", glob: "projects/porch/**" }),
      scopeDescription({ here: "_content", glob: "**/*.doc.card" }),
    ],
    ["the whole box", "the whole box", "recipes", "projects/porch", "**/*.doc.card"],
  );
});

// A query that includes referring todos adds "plus todos elsewhere that link
// here". When the scope is already the whole box there is no elsewhere, so the
// stock plate's line stops at "the whole box".
void test("A query that includes referring todos adds \"plus todos elsewhere that link he...", async (t) => {
  t.check(scopeLineText({ here: "_content", glob: "**", includeReferring: true }), "Scope: the whole box");

  t.check(scopeLineText({ here: "recipes", glob: "recipes/**", includeReferring: true }), "Scope: recipes, plus todos elsewhere that link here");

  t.check(scopeLineText({ here: "recipes", glob: "recipes/**", includeReferring: false }), "Scope: recipes");
});
