// # TodoItem — one rendering of a todo
//
// `TodoItem` is how a todo reads in a card body, in a card's frontmatter
// `todos:`, and in the todo list (`docs/plans/todos-ui.md`, Track 2). A
// checkbox leads, named by the todo's words; the words carry the status
// treatment; date and assignment chips follow. Plate state comes from the
// server, so only a todo the server calls `escalated` reads as overdue.

import { test } from "tap";
import "agent-doctest/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TodoItem } from "../../../src/components/todo/TodoItem.js";
import { dateChips, hiddenInReading, recheckChip, startPrefix } from "../../../src/components/todo/item-logic.js";

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
// checkbox is disabled; `todo-actions.doctest.md` covers the live one. These
// todos carry no known words (`text: null`), so each checkbox falls back to its
// status name.
void test("Only done is checked.", async (t) => {
  // doctest:L55
  t.check(summary(render({ status: "open" })), "unchecked | disabled | Open | text-warm-800");

  // doctest:L58
  t.check(summary(render({ status: "done" })), "checked | disabled | Done | text-warm-400 line-through");

  // doctest:L61
  t.check(summary(render({ status: "parked" })), "unchecked | disabled | Parked | text-warm-400");

  // doctest:L64
  t.check(summary(render({ status: "dropped" })), "unchecked | disabled | Dropped | text-warm-400 line-through");
});

// ## The checkbox is named by the todo
//
// Given the todo's words, the checkbox is named by them, so a list of todos is
// not a list of identical "Open" boxes. The checked state already says open or
// done; a parked or dropped todo, which a checkbox cannot express, leads with its
// status.
void test("Given the todo's words, the checkbox is named by them, so a list of todos is...", async (t) => {
  // doctest:L76
  t.check((["open", "done", "parked", "dropped"] as const).map((status) => summary(render({ status, text: "Call the roofer" })).split(" | ")[2]).join(" / "), "Call the roofer / Call the roofer / Parked: Call the roofer / Dropped: Call the roofer");
});

// The status and the locator ride on the element as data attributes, which is
// how the card summary finds the first open todo to scroll to.
void test("The status and the locator ride on the element as data attributes, which is h...", async (t) => {
  // doctest:L84
  await t.checkText(render({ status: "open", locator: { kind: "body", line: 12, nth: 2 } }).startsWith('<span data-todo-status="open" data-todo-locator="12#2" class="group">'), "true");

  // doctest:L87
  await t.checkText(render({ status: "done", locator: { kind: "frontmatter", index: 0 } }).includes('data-todo-locator="todos[0]"'), "true");
});

// ## Dates, and overdue only from the server
//
// A due date reads "due Sep 15". The same todo reads "overdue · Sep 15", with
// the warning treatment, once the server says it is escalated. Before the
// server answers (`plateState: null`) it is never shown as overdue.
void test("A due date reads \"due Sep 15\".", async (t) => {
  // doctest:L98
  const format = { nowYear: 2026, locale: "en-US" };
  t.check(dateChips({ due: "2026-09-15", start: undefined, plateState: null }, format).map((c) => c.text).join(", "), "due Sep 15");

  // doctest:L102
  t.check(dateChips({ due: "2026-09-15", start: undefined, plateState: "on-plate" }, format).map((c) => `${c.text} (${c.warning ? "warning" : "plain"})`).join(", "), "due Sep 15 (plain)");

  // doctest:L105
  t.check(dateChips({ due: "2026-09-15", start: "-1w", plateState: "escalated" }, format).map((c) => `${c.text} (${c.warning ? "warning" : "plain"})`).join(", "), "overdue · Sep 15 (warning), since Sep 8 (plain)");

  // doctest:L108
  t.check(dateChips({ due: "2027-01-04", start: undefined, plateState: null }, format)[0]?.text, "due Jan 4, 2027");

  // A `start` is the day the todo joins the plate. Until then the todo is
  // "later", the plate headline's word for it; after, the date reads "since".
  // Only an open todo's plate state says which. For a parked or finished todo,
  // or before the server answers, the start is compared with today's local date.

  // doctest:L118
  t.check(dateChips({ due: undefined, start: "2026-10-23", plateState: "quiet" }, format)[0]?.text, "later · Oct 23");

  // doctest:L121
  t.check(dateChips({ due: undefined, start: "2026-10-23", plateState: "on-plate" }, format)[0]?.text, "since Oct 23");

  // doctest:L124
  t.check(dateChips({ due: undefined, start: "2099-10-23", plateState: null }, format)[0]?.text, "later · Oct 23, 2099");

  // doctest:L127
  t.check(dateChips({ due: undefined, start: "2020-10-23", plateState: null }, format)[0]?.text, "since Oct 23, 2020");

  // doctest:L130
  t.check(dateChips({ due: undefined, start: "2099-10-23", plateState: "parked" }, format)[0]?.text, "later · Oct 23, 2099");

  // The comparison is by calendar day, so the start day itself is "since":

  // doctest:L137
  t.check(
    [
      startPrefix({ plateState: null, startIso: "2026-10-23", todayIso: "2026-10-22" }),
      startPrefix({ plateState: null, startIso: "2026-10-23", todayIso: "2026-10-23" }),
      startPrefix({ plateState: "done", startIso: "2026-10-23", todayIso: "2026-10-24" }),
    ].join(", "),
    "later ·, since, since",
  );
});

// Rendered, the escalated chip takes the warning tone and keeps the machine
// date in a `<time>`:
void test("Rendered, the escalated chip takes the warning tone and keeps the machine dat...", async (t) => {
  // doctest:L149
  const escalated = render({ status: "open", due: "2026-09-15", plateState: "escalated" });
  await t.checkText(escalated.includes("bg-accent-100") && escalated.includes('<time dateTime="2026-09-15">overdue · '), "true");

  // doctest:L153
  await t.checkText(render({ status: "open", due: "2026-09-15", plateState: "on-plate" }).includes("bg-accent-100"), "false");
});

// ## `recheck`: a quiet chip in the list only
//
// `recheck` is the todo-review's bookkeeping (`docs/plans/todos-ui.md`, Track
// 7). The list shows it as a quiet note, never a date chip; a finished todo
// shows none.
void test("recheck is the todo-review's bookkeeping (docs/plans/todos-ui.md, Track 7).", async (t) => {
  // doctest:L164
  const fmt = { nowYear: 2026, locale: "en-US" };
  t.check(
    [
      recheckChip({ status: "open", recheck: "2026-10-15" }, fmt)?.text,
      recheckChip({ status: "open", recheck: "never" }, fmt)?.text,
      String(recheckChip({ status: "done", recheck: "never" }, fmt)),
      String(recheckChip({ status: "open", recheck: undefined }, fmt)),
    ].join(" | "),
    "agent checks again Oct 15 | no longer reviewed | null | null",
  );
});

// The reading view (a card body, `inline`/`block`) never shows it; the list
// line does:
void test("The reading view (a card body, inline/block) never shows it; the list line does:", async (t) => {
  // doctest:L178
  await t.checkText(render({ status: "open", recheck: "2026-10-15", layout: "inline" }).includes("checks again"), "false");

  // doctest:L181
  await t.checkText(render({ status: "open", recheck: "2026-10-15", layout: "line" }).includes('<time dateTime="2026-10-15">agent checks again Oct 15</time>'), "true");
});

// ## Agent follow-ups
//
// An open agent todo reads in the quiet (parked) treatment with an "agent"
// chip. A finished one is hidden from a card's reading view entirely; a
// boxholder's finished todo is not.
void test("An open agent todo reads in the quiet (parked) treatment with an \"agent\" chip.", async (t) => {
  // doctest:L192
  const agentOpen = render({ status: "open", assigned: "agent" });
  t.check(summary(agentOpen), "unchecked | disabled | Open | text-warm-400");

  // doctest:L196
  await t.checkText(agentOpen.includes('data-todo-assigned="agent"') && agentOpen.includes(">agent</span>"), "true");

  // doctest:L199
  t.check(
    [
      hiddenInReading({ status: "done", assigned: "agent" }),
      hiddenInReading({ status: "dropped", assigned: "agent" }),
      hiddenInReading({ status: "open", assigned: "agent" }),
      hiddenInReading({ status: "done", assigned: undefined }),
    ].join(" "),
    "true true false false",
  );
});

// ## Context rows in the list
//
// A list ancestor kept only as context for a matching child is muted and
// carries no chips.
void test("A list ancestor kept only as context for a matching child is muted and carrie...", async (t) => {
  // doctest:L214
  const context = render({ status: "open", due: "2026-09-15", layout: "line", muted: true });
  t.check(summary(context) + " | chips: " + String(context.includes("due Sep")), "unchecked | disabled | Open | text-warm-400 | chips: false");
});
