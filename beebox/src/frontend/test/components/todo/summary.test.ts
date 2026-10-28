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
import { CountsLine, TodoSummaryLine } from "../../../src/components/todo/TodoSummaryLine.js";
import { controlTargetSelector, directoryListPath, rootLineParts, type SummaryReduction } from "../../../src/components/todo/summary.js";

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
  t.check(line({}), "");
});

// ## All done
//
// The card is finished; the line still says so, and "0 todos now" is not a
// control.
void test("The card is finished; the line still says so, and \"0 on your plate\" is not a...", async (t) => {
  t.check(text(line({ done: 2 }, noop)), "0 todos now · 2 done");
});

// ## Overdue
//
// `escalated` is the server's word for past due; the line calls it overdue.
// With an open todo rendered below, the first count is a button that scrolls
// to it.
void test("escalated is the server's word for past due; the line calls it overdue.", async (t) => {
  await t.checkText(text(line({ open: 3, onPlate: 3, escalated: 1, done: 2 }, noop)), "[3 todos now] · 1 overdue · 2 done");
});

// In a box view nothing is drawn to scroll to, so the same counts are plain
// text rather than a button that does nothing:
void test("In a box view nothing is drawn to scroll to, so the same counts are plain tex...", async (t) => {
  t.check(text(line({ open: 3, onPlate: 3, escalated: 1, done: 2 })), "3 todos now · 1 overdue · 2 done");
});

// Parked todos are named when there are any:
void test("Parked todos are named when there are any:", async (t) => {
  t.check(text(line({ open: 1, onPlate: 1, parked: 2 })), "1 todo now · 2 parked");
});

// ## Later
//
// An open todo whose `start` has not come yet is not due now; the line
// names it "later", as the plate's headline does. The control is the count
// of the todos it goes to: "now" when any are, else "later".
void test("An open todo whose start has not come yet is not due now; the line names...", async (t) => {
  await t.checkText(text(line({ open: 3, onPlate: 2 }, noop)), "[2 todos now] · 1 later");

  t.check(text(line({ open: 1, onPlate: 0 }, noop)), "0 todos now · [1 later]");
});

// On a card, the control scrolls to the first todo in the set it names. A todo
// must carry that plate state explicitly: one embedded from another card has
// none here, so it is never the target.
void test("On a card, the control scrolls to the first todo in the set it names.", async (t) => {
  t.check(
    controlTargetSelector({ onPlate: 0 }),
    "[data-todo-status=\"open\"]:not([data-todo-assigned=\"agent\"])[data-todo-plate-state=\"quiet\"]",
  );

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
  t.check(
    directoryListPath([
      { relativePath: "_content/projects/porch-rebuild/budget.doc.card", type: "doc" },
      { relativePath: "_content/projects/porch-rebuild/todos.todo-view.card", type: "todo-view" },
    ]),
    "_content/projects/porch-rebuild/todos.todo-view.card",
  );

  t.check(directoryListPath([{ relativePath: "_content/projects/porch-rebuild/budget.doc.card", type: "doc" }]), "_content/plate.todo-view.card");
});

// ## The root place's line
//
// The root place page shows one line from the nav badge's own counts
// (`docs/implemented-plans/front-door.md`, Track C): "3 to do · 1 overdue · 2 questions
// waiting". It never says "plate". `rootLineParts` builds it; `CountsLine`
// draws it, with the todo count and the questions count as controls that open
// their surfaces beside the chat.
function rootLine(counts: { onPlateTodos?: number; escalatedTodos?: number; laterTodos?: number; pendingQuestions?: number }) {
  const parts = rootLineParts({ onPlateTodos: 0, escalatedTodos: 0, laterTodos: 0, pendingQuestions: 0, ...counts });
  if (parts === null) return null;
  const action = { onClick: noop, title: "Open" };
  return text(renderToStaticMarkup(React.createElement(CountsLine, { parts, actions: { open: action, overdue: action, later: action, questions: action } })));
}

// Nothing to do and nothing asked: no line at all.
void test("Nothing to do and nothing asked: no line at all.", async (t) => {
  t.check(rootLine({}), null);
});

// Todos only. The overdue count is named when there is one; it opens the same
// todo view as "to do", so every count on the line opens its surface.
void test("Todos only. The overdue count is named when there is one and opens the todo view.", async (t) => {
  t.check([rootLine({ onPlateTodos: 3, escalatedTodos: 1 }), rootLine({ onPlateTodos: 2 })], [
    "[3 to do] · [1 overdue]",
    "[2 to do]",
  ]);
});

// Questions only: the line does not vanish when nothing is to do.
void test("Questions only: the line does not vanish when nothing is to do.", async (t) => {
  t.check([rootLine({ pendingQuestions: 2 }), rootLine({ pendingQuestions: 1 })], [
    "[2 questions waiting]",
    "[1 question waiting]",
  ]);
});

// Both:
void test("Both:", async (t) => {
  t.check(rootLine({ onPlateTodos: 3, escalatedTodos: 1, pendingQuestions: 2 }), "[3 to do] · [1 overdue] · [2 questions waiting]");
});

// Todos dated for later are named, so the Box page does not say "1 to do" when
// five more start later. The badge keeps counting only what is due now, so
// "to do" still agrees with it. With nothing to do now, "later" is the control.
void test("Todos dated for later are named after the ones due now.", async (t) => {
  t.check(
    [
      rootLine({ onPlateTodos: 1, laterTodos: 5 }),
      rootLine({ onPlateTodos: 3, escalatedTodos: 1, laterTodos: 2, pendingQuestions: 1 }),
      rootLine({ laterTodos: 4 }),
    ],
    [
      "[1 to do] · 5 later",
      "[3 to do] · [1 overdue] · 2 later · [1 question waiting]",
      "[4 later]",
    ],
  );
});
