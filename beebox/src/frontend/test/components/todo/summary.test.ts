// # The card's todo summary line
//
// At the top of a card, one quiet line says what its todos amount to: "3 on
// your plate · 1 later · 1 overdue · 2 done" (`docs/plans/todos-ui.md`, Track
// 4). It splits the open todos the way the plate does, so its numbers agree with
// the plate's headline and the nav badge. It is the
// boxholder-scope reduction of a query on the card itself, so an agent
// follow-up never counts. `CardTodos.tsx` owns that query; this is the line.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TodoSummaryLine } from "../../../src/components/todo/TodoSummaryLine.js";
import { controlTargetSelector, directoryListPath, type SummaryReduction } from "../../../src/components/todo/summary.js";

globalThis.React = React;

const none = { open: 0, onPlate: 0, done: 0, parked: 0, escalated: 0 };

const noop = () => {};

function line(reduction: Partial<SummaryReduction>, onClick?: () => void) {
  const openAction = onClick === undefined ? null : { onClick, title: "Go to the first open todo" };
  return renderToStaticMarkup(React.createElement(TodoSummaryLine, { reduction: { ...none, ...reduction }, openAction }));
}

/** The line as a reader sees it: tags stripped, `[…]` around the one control. */
function text(html: string) {
  return html.replace(/<button[^>]*>([^<]*)<\/button>/g, "[$1]").replace(/<[^>]+>/g, "");
}

// ## No todos, no line
void test("No todos, no line", async (t) => {
  // doctest:L34
  t.check(line({}), "");
});

// ## All done
//
// The card is finished; the line still says so, and "0 on your plate" is not a
// control.
void test("The card is finished; the line still says so, and \"0 on your plate\" is not a...", async (t) => {
  // doctest:L44
  t.check(text(line({ done: 2 }, noop)), "0 on your plate · 2 done");
});

// ## Overdue
//
// `escalated` is the server's word for past due; the line calls it overdue.
// With an open todo rendered below, the first count is a button that scrolls
// to it.
void test("escalated is the server's word for past due; the line calls it overdue.", async (t) => {
  // doctest:L55
  await t.checkText(text(line({ open: 3, onPlate: 3, escalated: 1, done: 2 }, noop)), "[3 on your plate] · 1 overdue · 2 done");
});

// In a box view nothing is drawn to scroll to, so the same counts are plain
// text rather than a button that does nothing:
void test("In a box view nothing is drawn to scroll to, so the same counts are plain tex...", async (t) => {
  // doctest:L63
  t.check(text(line({ open: 3, onPlate: 3, escalated: 1, done: 2 })), "3 on your plate · 1 overdue · 2 done");
});

// Parked todos are named when there are any:
void test("Parked todos are named when there are any:", async (t) => {
  // doctest:L70
  t.check(text(line({ open: 1, onPlate: 1, parked: 2 })), "1 on your plate · 2 parked");
});

// ## Later
//
// An open todo whose `start` has not come yet is not on the plate; the line
// names it "later", as the plate's headline does. The control is the count
// of the todos it goes to: "on your plate" when any are, else "later".
void test("An open todo whose start has not come yet is not on the plate; the line names...", async (t) => {
  // doctest:L81
  await t.checkText(text(line({ open: 3, onPlate: 2 }, noop)), "[2 on your plate] · 1 later");

  // doctest:L84
  t.check(text(line({ open: 1, onPlate: 0 }, noop)), "0 on your plate · [1 later]");
});

// On a card, the control scrolls to the first todo in the set it names. A todo
// must carry that plate state explicitly: one embedded from another card has
// none here, so it is never the target.
void test("On a card, the control scrolls to the first todo in the set it names.", async (t) => {
  // doctest:L93
  t.check(
    controlTargetSelector({ onPlate: 0 }),
    "[data-todo-status=\"open\"]:not([data-todo-assigned=\"agent\"])[data-todo-plate-state=\"quiet\"]",
  );

  // doctest:L96
  t.check(
    controlTargetSelector({ onPlate: 2 }),
    "[data-todo-status=\"open\"]:not([data-todo-assigned=\"agent\"])[data-todo-plate-state=\"on-plate\"], [data-todo-status=\"open\"]:not([data-todo-assigned=\"agent\"])[data-todo-plate-state=\"escalated\"]",
  );
});

// ## A directory's line
//
// A directory's browse page shows the same line for every card under it
// (`DirectoryTodos.tsx`), from a query on the directory with no reference
// pass. Its "open" control opens the directory's list: its own `todo-view` card
// when one sits directly in it, else the plate.
void test("A directory's browse page shows the same line for every card under it (Direct...", async (t) => {
  // doctest:L108
  t.check(
    directoryListPath([
      { relativePath: "_content/projects/porch-rebuild/budget.doc.card", type: "doc" },
      { relativePath: "_content/projects/porch-rebuild/todos.todo-view.card", type: "todo-view" },
    ]),
    "_content/projects/porch-rebuild/todos.todo-view.card",
  );

  // doctest:L114
  t.check(directoryListPath([{ relativePath: "_content/projects/porch-rebuild/budget.doc.card", type: "doc" }]), "_content/plate.todo-view.card");
});
