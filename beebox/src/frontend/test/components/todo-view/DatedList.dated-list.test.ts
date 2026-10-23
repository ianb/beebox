// # The Todos "By date" tab
//
// Each dated todo is one line: a date chip, the todo's words, the card's name.
// An overdue deadline says "overdue" in the warning tone; a deadline not yet
// reached reads "due" in the neutral tone the card rows use. The todo text
// truncates so the card name stays on its own item's line.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DatedList } from "../../../src/components/todo-view/DatedList.js";
import { optionsFrom } from "../../../src/components/todo-view/TodoViewControls.js";
import type { DatedTodo, TodoRowItem } from "../../../src/components/todo-view-card-logic.js";

globalThis.React = React;

function dated(text: string, { kind, date, plateState }: { kind: "due" | "start"; date: string; plateState: TodoRowItem["plateState"] }): DatedTodo {
  const item: TodoRowItem = {
    path: "House.doc.card",
    locator: { kind: "body", line: 1 },
    text,
    status: "open",
    plateState,
    stirring: false,
    seeAlso: [],
    refs: [],
    sectionPath: [],
    parent: null,
    annotation: "",
    matching: true,
  };
  return { key: text, item, date, kind, cardPath: "House.doc.card", cardTitle: "House jobs" };
}

/** Each line as its chip title, chip text, tone, and whether the words truncate. */
function lines(html: string): string[] {
  return html.split('<div class="flex').slice(2).map((line) => {
    const chip = /<span class="([^"]*)"[^>]*title="([^"]*)"[^>]*>(.*?)<\/span>/.exec(line);
    const text = (chip?.[3] ?? "").replace(/<[^>]*>/g, "");
    const classes = chip?.[1] ?? "";
    const tone = classes.includes("bg-accent-100") ? "warning" : classes.includes("bg-warm-100") ? "neutral" : "other";
    return `${chip?.[2] ?? "-"} | ${text} | ${tone} | truncates=${String(line.includes("truncate"))}`;
  });
}

void test("An overdue deadline says overdue in the warning tone; a future one does not.", async (t) => {
  const html = renderToStaticMarkup(React.createElement(DatedList, {
    boxSlug: undefined,
    dated: [
      dated("Pay the council tax", { kind: "due", date: "2026-10-02", plateState: "escalated" }),
      dated("Renew the car insurance", { kind: "due", date: "2026-11-30", plateState: "on-plate" }),
    ],
  }));
  t.check(lines(html), [
    "Overdue | overdue Oct 2, 2026 | warning | truncates=true",
    "Due | due Nov 30, 2026 | neutral | truncates=true",
  ]);
});

void test("With no dated todo the tab says so.", async (t) => {
  const html = renderToStaticMarkup(React.createElement(DatedList, { boxSlug: undefined, dated: [] }));
  t.check(html.replace(/<[^>]*>/g, ""), "No todos with a date.");
});

void test("The date tab is a stored view option; unknown values fall back to place.", async (t) => {
  t.check(optionsFrom({ group: "date" }).group, "date");
  t.check(optionsFrom({ group: "status" }).group, "status");
  t.check(optionsFrom({ group: "bogus" }).group, "place");
  t.check(optionsFrom(null).group, "place");
});
