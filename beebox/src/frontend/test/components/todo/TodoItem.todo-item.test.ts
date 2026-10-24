// # TodoItem — one rendering of a todo
//
// `TodoItem` is how a todo reads in a card body, in a card's frontmatter
// `todos:`, and in the todo list (`docs/plans/todos-ui.md`, Track 2). A
// checkbox leads, named by the todo's words; the words carry the status
// treatment; date and assignment chips follow. Plate state comes from the
// server, so only a todo the server calls `escalated` reads as overdue.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TodoItem } from "../../../src/components/todo/TodoItem.js";
import { dateChips, dueWord, hiddenInReading, nextDateOf, recheckChip, startPrefix } from "../../../src/components/todo/item-logic.js";

globalThis.React = React;

type TodoItemProps = React.ComponentProps<typeof TodoItem>;
function render(props: Partial<TodoItemProps> & Pick<TodoItemProps, "status">) {
  return renderToStaticMarkup(React.createElement(TodoItem, {
    assigned: undefined,
    due: undefined,
    start: undefined,
    plateState: null,
    layout: "inline",
    locator: null,
    cardPath: null,
    text: null,
    muted: false,
    children: null,
    ...props,
  }, "Call the roofer"));
}

/** The checkbox's state and name, and the class on the todo's own words. */
function summary(html: string) {
  const box = /<input[^>]*>/.exec(html)?.[0] ?? "";
  const words = /<span class="([^"]*)">Call the roofer<\/span>/.exec(html)?.[1] ?? "(none)";
  return [
    box.includes("checked") ? "checked" : "unchecked",
    box.includes("disabled") ? "disabled" : "live",
    /aria-label="([^"]*)"/.exec(box)?.[1],
    words,
  ].join(" | ");
}

// ## The four statuses
//
// Only `done` is checked. Rendered with no `TodoActionsContext` (as here) every
// checkbox is disabled; `src/frontend/test/components/todo/actions.test.ts` covers the live one. These
// todos carry no known words (`text: null`), so each checkbox falls back to its
// status name.
void test("Only done is checked.", async (t) => {
  t.check(summary(render({ status: "open" })), "unchecked | disabled | Open | text-card-ink");

  t.check(summary(render({ status: "done" })), "checked | disabled | Done | text-card-soft bbx-struck");

  t.check(summary(render({ status: "parked" })), "unchecked | disabled | Parked | text-card-soft");

  t.check(summary(render({ status: "dropped" })), "unchecked | disabled | Dropped | text-card-soft bbx-struck");
});

// ## The checkbox is named by the todo
//
// Given the todo's words, the checkbox is named by them, so a list of todos is
// not a list of identical "Open" boxes. The checked state already says open or
// done; a parked or dropped todo, which a checkbox cannot express, leads with its
// status.
void test("Given the todo's words, the checkbox is named by them, so a list of todos is...", async (t) => {
  t.check((["open", "done", "parked", "dropped"] as const).map((status) => summary(render({ status, text: "Call the roofer" })).split(" | ")[2]).join(" / "), "Call the roofer / Call the roofer / Parked: Call the roofer / Dropped: Call the roofer");
});

// The status and the locator ride on the element as data attributes, which is
// how the card summary finds the first open todo to scroll to.
void test("The status and the locator ride on the element as data attributes, which is h...", async (t) => {
  t.checkText(render({ status: "open", locator: { kind: "body", line: 12, nth: 2 } }), "<span data-todo-status=\"open\" data-todo-locator=\"12#2\" class=\"group\"><input type=\"checkbox\" disabled=\"\" readonly=\"\" aria-label=\"Open\" class=\"accent-warm-500 mr-1 align-middle\"/><span class=\"text-card-ink\">Call the roofer</span></span>");

  t.checkText(render({ status: "done", locator: { kind: "frontmatter", index: 0 } }), "<span data-todo-status=\"done\" data-todo-locator=\"todos[0]\" class=\"group\"><input type=\"checkbox\" disabled=\"\" readonly=\"\" aria-label=\"Done\" class=\"accent-warm-500 mr-1 align-middle\" checked=\"\"/><span class=\"text-card-soft bbx-struck\">Call the roofer</span></span>");
});

// ## Dates, and overdue only from the server
//
// A due date reads "due Sep 15". The same todo reads "overdue · Sep 15", with
// the warning treatment, once the server says it is escalated. Before the
// server answers (`plateState: null`) it is never shown as overdue.
void test("A due date reads \"due Sep 15\".", async (t) => {
  const format = { nowYear: 2026, locale: "en-US" };
  t.check(dateChips({ due: "2026-09-15", start: undefined, plateState: null }, format),[
    { kind: "due", iso: "2026-09-15", text: "due Sep 15", warning: false },
  ]);

  t.check(dateChips({ due: "2026-09-15", start: undefined, plateState: "on-plate" }, format), [
    { kind: "due", iso: "2026-09-15", text: "due Sep 15", warning: false },
  ]);

  t.check(dateChips({ due: "2026-09-15", start: "-1w", plateState: "escalated" }, format), [
    { kind: "due", iso: "2026-09-15", text: "overdue · Sep 15", warning: true },
    { kind: "start", iso: "2026-09-08", text: "since Sep 8", warning: false },
  ]);

  t.check(dateChips({ due: "2027-01-04", start: undefined, plateState: null }, format), [
    { kind: "due", iso: "2027-01-04", text: "due Jan 4, 2027", warning: false },
  ]);

  // A `start` is the day the todo joins the plate. Until then the todo is
  // "later", the plate headline's word for it; after, the date reads "since".
  // Only an open todo's plate state says which. For a parked or finished todo,
  // or before the server answers, the start is compared with today's local date.

  t.check(dateChips({ due: undefined, start: "2026-10-23", plateState: "quiet" }, format), [
    { kind: "start", iso: "2026-10-23", text: "later · Oct 23", warning: false },
  ]);

  t.check(dateChips({ due: undefined, start: "2026-10-23", plateState: "on-plate" }, format), [
    { kind: "start", iso: "2026-10-23", text: "since Oct 23", warning: false },
  ]);

  t.check(dateChips({ due: undefined, start: "2099-10-23", plateState: null }, format), [
    { kind: "start", iso: "2099-10-23", text: "later · Oct 23, 2099", warning: false },
  ]);

  t.check(dateChips({ due: undefined, start: "2020-10-23", plateState: null }, format), [
    { kind: "start", iso: "2020-10-23", text: "since Oct 23, 2020", warning: false },
  ]);

  t.check(dateChips({ due: undefined, start: "2099-10-23", plateState: "parked" }, format), [
    { kind: "start", iso: "2099-10-23", text: "later · Oct 23, 2099", warning: false },
  ]);

  // The comparison is by calendar day, so the start day itself is "since":

  t.check(
    [
      startPrefix({ plateState: null, startIso: "2026-10-23", todayIso: "2026-10-22" }),
      startPrefix({ plateState: null, startIso: "2026-10-23", todayIso: "2026-10-23" }),
      startPrefix({ plateState: "done", startIso: "2026-10-23", todayIso: "2026-10-24" }),
    ],
    ["later ·", "since", "since"],
  );
});

// Rendered, the escalated chip takes the warning tone and keeps the machine
// date in a `<time>`:
void test("Rendered, the escalated chip takes the warning tone and keeps the machine dat...", async (t) => {
  const escalated = render({ status: "open", due: "2026-09-15", plateState: "escalated" });
  t.checkText(escalated, "<span data-todo-status=\"open\" data-todo-plate-state=\"escalated\" class=\"group\"><input type=\"checkbox\" disabled=\"\" readonly=\"\" aria-label=\"Open\" class=\"accent-warm-500 mr-1 align-middle\"/><span class=\"text-card-ink\">Call the roofer</span><span class=\"inline-block rounded font-medium bg-accent-100 text-accent-dark text-[10px] px-1.5 py-0.5 ml-1 align-middle\"><time dateTime=\"2026-09-15\">overdue · Sep 15</time></span></span>");

  t.checkText(render({ status: "open", due: "2026-09-15", plateState: "on-plate" }), "<span data-todo-status=\"open\" data-todo-plate-state=\"on-plate\" class=\"group\"><input type=\"checkbox\" disabled=\"\" readonly=\"\" aria-label=\"Open\" class=\"accent-warm-500 mr-1 align-middle\"/><span class=\"text-card-ink\">Call the roofer</span><span class=\"inline-block rounded font-medium bg-warm-100 text-warm-700 text-[10px] px-1.5 py-0.5 ml-1 align-middle\"><time dateTime=\"2026-09-15\">due Sep 15</time></span></span>");
});

// ## `recheck`: a quiet chip in the list only
//
// `recheck` is the todo-review's bookkeeping (`docs/plans/todos-ui.md`, Track
// 7). The list shows it as a quiet note, never a date chip; a finished todo
// shows none.
void test("recheck is the todo-review's bookkeeping (docs/plans/todos-ui.md, Track 7).", async (t) => {
  const fmt = { nowYear: 2026, locale: "en-US" };
  t.check(
    [
      recheckChip({ status: "open", recheck: "2026-10-15" }, fmt),
      recheckChip({ status: "open", recheck: "never" }, fmt),
      recheckChip({ status: "done", recheck: "never" }, fmt),
      recheckChip({ status: "open", recheck: undefined }, fmt),
    ],
    [
      { iso: "2026-10-15", text: "agent checks again Oct 15" },
      { iso: null, text: "no longer reviewed" },
      null,
      null,
    ],
  );
});

// The reading view (a card body, `inline`/`block`) never shows it; the list
// line does:
void test("The reading view (a card body, inline/block) never shows it; the list line does:", async (t) => {
  t.checkText(render({ status: "open", recheck: "2026-10-15", layout: "inline" }), "<span data-todo-status=\"open\" class=\"group\"><input type=\"checkbox\" disabled=\"\" readonly=\"\" aria-label=\"Open\" class=\"accent-warm-500 mr-1 align-middle\"/><span class=\"text-card-ink\">Call the roofer</span></span>");

  t.checkText(render({ status: "open", recheck: "2026-10-15", layout: "line" }), "<span data-todo-status=\"open\" class=\"group flex items-start gap-1.5 text-sm\"><input type=\"checkbox\" disabled=\"\" readonly=\"\" aria-label=\"Open\" class=\"accent-warm-500 mt-0.5 shrink-0\"/><span class=\"min-w-0 flex-1\"><span class=\"text-card-ink\">Call the roofer</span><span class=\"ml-1.5 align-middle\" title=\"When the daily todo review looks at this again\"><span class=\"text-warm-700 text-xs\"><time dateTime=\"2026-10-15\">agent checks again Oct 15</time></span></span></span></span>");
});

// ## Agent follow-ups
//
// An open agent todo reads in the quiet (parked) treatment with an "agent"
// chip. A finished one is hidden from a card's reading view entirely; a
// boxholder's finished todo is not.
void test("An open agent todo reads in the quiet (parked) treatment with an \"agent\" chip.", async (t) => {
  const agentOpen = render({ status: "open", assigned: "agent" });
  t.check(summary(agentOpen), "unchecked | disabled | Open | text-card-soft");

  t.checkText(agentOpen, "<span data-todo-status=\"open\" data-todo-assigned=\"agent\" class=\"group\"><input type=\"checkbox\" disabled=\"\" readonly=\"\" aria-label=\"Open\" class=\"accent-warm-500 mr-1 align-middle\"/><span class=\"text-card-soft\">Call the roofer</span><span class=\"inline-block rounded font-medium bg-warm-100 text-warm-700 text-[10px] px-1.5 py-0.5 ml-1 align-middle\" title=\"Assigned\">agent</span></span>");

  t.check(
    [
      hiddenInReading({ status: "done", assigned: "agent" }),
      hiddenInReading({ status: "dropped", assigned: "agent" }),
      hiddenInReading({ status: "open", assigned: "agent" }),
      hiddenInReading({ status: "done", assigned: undefined }),
    ],
    [true, true, false, false],
  );
});

// ## Context rows in the list
//
// A list ancestor kept only as context for a matching child is muted and
// carries no chips.
void test("A list ancestor kept only as context for a matching child is muted and carrie...", async (t) => {
  const context = render({ status: "open", due: "2026-09-15", layout: "line", muted: true });
  t.check(summary(context), "unchecked | disabled | Open | text-card-soft");
  t.checkText(context, "<span data-todo-status=\"open\" class=\"group flex items-start gap-1.5 text-sm\"><input type=\"checkbox\" disabled=\"\" readonly=\"\" aria-label=\"Open\" class=\"accent-warm-500 mt-0.5 shrink-0\"/><span class=\"min-w-0 flex-1\"><span class=\"text-card-soft\">Call the roofer</span></span></span>");
});

// ## A card row's next date says which date it is
//
// The earliest date among a card's open todos, with the word the dated strip
// would use for it. A due date wins a tie with a start; finished and parked
// todos do not count.
void test("A card row's next date names the kind of the earliest date.", async (t) => {
  const open = (extra: { due?: string; start?: string; plateState?: "quiet" | "on-plate" | "escalated" }) =>
    ({ status: "open" as const, plateState: "quiet" as const, ...extra });
  t.check(
    [
      nextDateOf([]),
      nextDateOf([open({}), open({ start: "2026-10-24" }), open({ due: "2026-11-07" })]),
      nextDateOf([open({ due: "2026-10-15", plateState: "escalated" }), open({ start: "2026-10-24" })]),
      nextDateOf([open({ start: "2026-10-24" }), open({ due: "2026-10-24" })]),
      nextDateOf([open({ start: "2026-10-01", plateState: "on-plate" })]),
      nextDateOf([{ status: "done", due: "2026-01-01", plateState: null }, { status: "parked", start: "2026-01-02", plateState: null }]),
      [dueWord(null), dueWord("quiet"), dueWord("escalated")],
    ],
    [
      null,
      { iso: "2026-10-24", word: "starts" },
      { iso: "2026-10-15", word: "overdue" },
      { iso: "2026-10-24", word: "due" },
      { iso: "2026-10-01", word: "since" },
      null,
      ["due", "due", "overdue"],
    ],
  );
});
