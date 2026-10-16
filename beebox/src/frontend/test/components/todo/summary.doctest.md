# The card's todo summary line

At the top of a card, one quiet line says what its todos amount to: "3 on
your plate · 1 later · 1 overdue · 2 done" (`docs/plans/todos-ui.md`, Track
4). It splits the open todos the way the plate does, so its numbers agree with
the plate's headline and the nav badge. It is the
boxholder-scope reduction of a query on the card itself, so an agent
follow-up never counts. `CardTodos.tsx` owns that query; this is the line.

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TodoSummaryLine } from "../../../src/components/todo/TodoSummaryLine.js";
import { controlTargetSelector, directoryListPath } from "../../../src/components/todo/summary.js";

globalThis.React = React;

const none = { open: 0, onPlate: 0, done: 0, parked: 0, escalated: 0 };

function line(reduction, onClick = null) {
  const openAction = onClick === null ? null : { onClick, title: "Go to the first open todo" };
  return renderToStaticMarkup(React.createElement(TodoSummaryLine, { reduction: { ...none, ...reduction }, openAction }));
}

/** The line as a reader sees it: tags stripped, `[…]` around the one control. */
function text(html) {
  return html.replace(/<button[^>]*>([^<]*)<\/button>/g, "[$1]").replace(/<[^>]+>/g, "");
}
```

## No todos, no line

```ts
line({})
=> 
```

## All done

The card is finished; the line still says so, and "0 on your plate" is not a
control.

```ts
text(line({ done: 2 }, () => undefined))
=> 0 on your plate · 2 done
```

## Overdue

`escalated` is the server's word for past due; the line calls it overdue.
With an open todo rendered below, the first count is a button that scrolls
to it.

```ts
text(line({ open: 3, onPlate: 3, escalated: 1, done: 2 }, () => undefined))
=> [3 on your plate] · 1 overdue · 2 done
```

In a box view nothing is drawn to scroll to, so the same counts are plain
text rather than a button that does nothing:

```ts
text(line({ open: 3, onPlate: 3, escalated: 1, done: 2 }))
=> 3 on your plate · 1 overdue · 2 done
```

Parked todos are named when there are any:

```ts
text(line({ open: 1, onPlate: 1, parked: 2 }))
=> 1 on your plate · 2 parked
```

## Later

An open todo whose `start` has not come yet is not on the plate; the line
names it "later", as the plate's headline does. The control is the count
of the todos it goes to: "on your plate" when any are, else "later".

```ts
text(line({ open: 3, onPlate: 2 }, () => undefined))
=> [2 on your plate] · 1 later

text(line({ open: 1, onPlate: 0 }, () => undefined))
=> 0 on your plate · [1 later]
```

On a card, the control scrolls to the first todo in the set it names. A todo
must carry that plate state explicitly: one embedded from another card has
none here, so it is never the target.

```ts
controlTargetSelector({ onPlate: 0 }).includes('[data-todo-plate-state="quiet"]')
=> true

controlTargetSelector({ onPlate: 2 }).includes("quiet")
=> false
```

## A directory's line

A directory's browse page shows the same line for every card under it
(`DirectoryTodos.tsx`), from a query on the directory with no reference
pass. Its "open" control opens the directory's list: its own `todo-view` card
when one sits directly in it, else the plate.

```ts
directoryListPath([
  { relativePath: "_content/projects/porch-rebuild/budget.doc.card", type: "doc" },
  { relativePath: "_content/projects/porch-rebuild/todos.todo-view.card", type: "todo-view" },
])
=> _content/projects/porch-rebuild/todos.todo-view.card

directoryListPath([{ relativePath: "_content/projects/porch-rebuild/budget.doc.card", type: "doc" }])
=> _content/plate.todo-view.card
```
