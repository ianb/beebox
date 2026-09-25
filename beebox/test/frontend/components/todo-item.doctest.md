# TodoItem — one rendering of a todo

`TodoItem` is how a todo reads in a card body, in a card's frontmatter
`todos:`, and in the todo list (`docs/plans/todos-ui.md`, Track 2). A
checkbox leads, named by the status; the words carry the status
treatment; date and assignment chips follow. Plate state comes from the
server, so only a todo the server calls `escalated` reads as overdue.

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TodoItem } from "../../../src/frontend/src/components/todo/TodoItem.js";
import { dateChips, hiddenInReading } from "../../../src/frontend/src/components/todo/todo-item-logic.js";

globalThis.React = React;

function render(props) {
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
    ...props,
  }, "Call the roofer"));
}

/** The checkbox's state and name, and the class on the todo's own words. */
function summary(html) {
  const box = /<input[^>]*>/.exec(html)?.[0] ?? "";
  const words = /<span class="([^"]*)">Call the roofer<\/span>/.exec(html)?.[1] ?? "(none)";
  return [
    box.includes("checked") ? "checked" : "unchecked",
    box.includes("disabled") ? "disabled" : "live",
    /aria-label="([^"]*)"/.exec(box)?.[1],
    words,
  ].join(" | ");
}
```

## The four statuses

Only `done` is checked. Rendered with no `TodoActionsContext` (as here) every
checkbox is disabled; `todo-actions.doctest.md` covers the live one. Each is
named by its status, so a parked or dropped todo is announced as what it is.

```ts
summary(render({ status: "open" }))
=> unchecked | disabled | Open | text-warm-800

summary(render({ status: "done" }))
=> checked | disabled | Done | text-warm-400 line-through

summary(render({ status: "parked" }))
=> unchecked | disabled | Parked | text-warm-400

summary(render({ status: "dropped" }))
=> unchecked | disabled | Dropped | text-warm-400 line-through
```

The status and the locator ride on the element as data attributes, which is
how the card summary finds the first open todo to scroll to.

```ts
render({ status: "open", locator: { kind: "body", line: 12, nth: 2 } }).startsWith('<span data-todo-status="open" data-todo-locator="12#2" class="group">')
=> true

render({ status: "done", locator: { kind: "frontmatter", index: 0 } }).includes('data-todo-locator="todos[0]"')
=> true
```

## Dates, and overdue only from the server

A due date reads "due Sep 15". The same todo reads "overdue · Sep 15", with
the warning treatment, once the server says it is escalated. Before the
server answers (`plateState: null`) it is never shown as overdue.

```ts
const format = { nowYear: 2026, locale: "en-US" };
dateChips({ due: "2026-09-15", start: undefined, plateState: null }, format).map((c) => c.text).join(", ")
=> due Sep 15

dateChips({ due: "2026-09-15", start: undefined, plateState: "on-plate" }, format).map((c) => `${c.text} (${c.warning ? "warning" : "plain"})`).join(", ")
=> due Sep 15 (plain)

dateChips({ due: "2026-09-15", start: "-1w", plateState: "escalated" }, format).map((c) => `${c.text} (${c.warning ? "warning" : "plain"})`).join(", ")
=> overdue · Sep 15 (warning), starts Sep 8 (plain)

dateChips({ due: "2027-01-04", start: undefined, plateState: null }, format)[0].text
=> due Jan 4, 2027
```

Rendered, the escalated chip takes the warning tone and keeps the machine
date in a `<time>`:

```ts
const escalated = render({ status: "open", due: "2026-09-15", plateState: "escalated" });
escalated.includes("bg-accent-100") && escalated.includes('<time dateTime="2026-09-15">overdue · ')
=> true

render({ status: "open", due: "2026-09-15", plateState: "on-plate" }).includes("bg-accent-100")
=> false
```

## Agent follow-ups

An open agent todo reads in the quiet (parked) treatment with an "agent"
chip. A finished one is hidden from a card's reading view entirely; a
boxholder's finished todo is not.

```ts
const agentOpen = render({ status: "open", assigned: "agent" });
summary(agentOpen)
=> unchecked | disabled | Open | text-warm-400

agentOpen.includes('data-todo-assigned="agent"') && agentOpen.includes(">agent</span>")
=> true

[
  hiddenInReading({ status: "done", assigned: "agent" }),
  hiddenInReading({ status: "dropped", assigned: "agent" }),
  hiddenInReading({ status: "open", assigned: "agent" }),
  hiddenInReading({ status: "done", assigned: undefined }),
].join(" ")
=> true true false false
```

## Context rows in the list

A list ancestor kept only as context for a matching child is muted and
carries no chips.

```ts
const context = render({ status: "open", due: "2026-09-15", layout: "line", muted: true });
summary(context) + " | chips: " + String(context.includes("due Sep"))
=> unchecked | disabled | Open | text-warm-400 | chips: false
```
