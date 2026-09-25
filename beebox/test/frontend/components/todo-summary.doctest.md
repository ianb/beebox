# The card's todo summary line

At the top of a card, one quiet line says what its todos amount to: "3 open ·
1 overdue · 2 done" (`docs/plans/todos-ui.md`, Track 4). It is the
boxholder-scope reduction of a query on the card itself, so an agent
follow-up never counts. `CardTodos.tsx` owns that query; this is the line.

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TodoSummaryLine } from "../../../src/frontend/src/components/todo/TodoSummaryLine.js";
import { directoryListPath } from "../../../src/frontend/src/components/todo/todo-summary.js";

globalThis.React = React;

const none = { open: 0, done: 0, parked: 0, escalated: 0 };

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

The card is finished; the line still says so, and "0 open" is not a control.

```ts
text(line({ done: 2 }, () => undefined))
=> 0 open · 2 done
```

## Overdue

`escalated` is the server's word for past due; the line calls it overdue.
With an open todo rendered below, "3 open" is a button that scrolls to it.

```ts
text(line({ open: 3, escalated: 1, done: 2 }, () => undefined))
=> [3 open] · 1 overdue · 2 done
```

In a box view nothing is drawn to scroll to, so the same counts are plain
text rather than a button that does nothing:

```ts
text(line({ open: 3, escalated: 1, done: 2 }))
=> 3 open · 1 overdue · 2 done
```

Parked todos are named when there are any:

```ts
text(line({ open: 1, parked: 2 }))
=> 1 open · 2 parked
```

## A directory's line

A directory's browse page shows the same line for every card under it
(`DirectoryTodos.tsx`), from a query on the directory with no reference
pass. No boxholder todos, no line — the same rule as a card:

```ts
line({})
=> 

text(line({ open: 4, escalated: 1, done: 3 }, () => undefined))
=> [4 open] · 1 overdue · 3 done
```

"4 open" opens the directory's list: its own `todo-view` card when one sits
directly in it, else the plate.

```ts
directoryListPath([
  { relativePath: "_content/projects/porch-rebuild/budget.memo.card", type: "memo" },
  { relativePath: "_content/projects/porch-rebuild/todos.todo-view.card", type: "todo-view" },
])
=> _content/projects/porch-rebuild/todos.todo-view.card

directoryListPath([{ relativePath: "_content/projects/porch-rebuild/budget.memo.card", type: "memo" }])
=> _content/plate.todo-view.card
```
