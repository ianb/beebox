# Nested frontmatter references

Objects that carry a `ref` alongside descriptive fields keep both the link and
the sibling fields visible.

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FrontmatterFields } from "../../src/components/MarkdownCardView/FrontmatterFields.js";

globalThis.React = React;

const html = renderToStaticMarkup(
  React.createElement(FrontmatterFields, {
    fields: {
      context: [{ ref: "../Course.course.card", text: "Acids and bases" }],
    },
    onNavigate: () => undefined,
    basePath: "_content/questions/Question.question.card",
  }),
);
```

```ts
html.includes("<button") && html.includes("../Course.course.card") && html.includes("Acids and bases")
=> true
```

## Frontmatter todos render as todos

A card's `todos:` list renders through `TodoItem`, the same as a body todo
(`docs/plans/todos-ui.md`, Track 2), rather than as `text:`/`due:` rows.
Each entry is addressed as the collector addresses it,
`{ kind: "frontmatter", index }`, which is also how it finds its plate state
in the card's todo context. A finished agent follow-up is left out.

```ts setup
import { CardTodosContext, indexPlateStates } from "../../src/components/todo/card-todos-context.js";

const cardPath = "_content/projects/Porch.memo.card";
const todos = [
  { text: "Book the inspector", due: "2026-09-15" },
  { text: "Summarize the quotes", assigned: "agent", status: "done" },
  { text: "Order lumber", status: "done" },
];

function renderFields(fields, context) {
  const table = React.createElement(FrontmatterFields, { fields, onNavigate: () => undefined, basePath: cardPath });
  return renderToStaticMarkup(context === undefined ? table : React.createElement(CardTodosContext.Provider, { value: context }, table));
}

const plate = indexPlateStates(cardPath, [
  { path: cardPath, locator: { kind: "frontmatter", index: 0 }, plateState: "escalated" },
  { path: cardPath, locator: { kind: "frontmatter", index: 2 }, plateState: "done" },
]);
```

```ts
const fm = renderFields({ todos });
[...fm.matchAll(/data-todo-status="(\w+)"(?: data-todo-assigned="\w+")? data-todo-locator="([^"]*)"/g)].map((m) => `${m[2]}:${m[1]}`).join(" ")
=> todos[0]:open todos[2]:done

fm.includes("Summarize the quotes") || fm.includes(">text:<")
=> false
```

Once the card's query answers, the overdue entry says so:

```ts
renderFields({ todos }).includes("overdue")
=> false

renderFields({ todos }, plate).includes("overdue · ")
=> true
```

A `todos:` value that is not a valid todo list keeps the generic rendering,
and only a top-level `todos` key is special:

```ts
renderFields({ todos: [{ due: "2026-09-15" }] }).includes("data-todo-status")
=> false

renderFields({ meta: { todos } }).includes("data-todo-status")
=> false
```

Which fields the card front passes to this table is decided by
`splitCardFields` (`test/lib/card-field-faces.doctest.md`).

## A body heading that repeats the title is hidden

The card page shows the title from `title:`. A body that opens with the same
`# heading` would show it twice, so the view leaves that line out. It uses
`leadingTitleHeading`, the predicate lint warns with
(`test/shared/leading-title-heading.doctest.md`). The line is blanked rather
than removed, so a todo further down keeps the locator the collector gives it:
body line 5 after a three-line frontmatter is file line 8.

```ts setup
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { MarkdownCardView } from "../../src/components/MarkdownCardView/view.js";
import { BoxSlugProvider } from "../../src/lib/box-slug.js";

/** Render a doc card's view inside a router and a query client that never answers. */
async function renderCard(body) {
  const data = {
    path: "_content/Trip.doc.card",
    frontmatter: { title: "Trip Report" },
    body,
    bodyLineOffset: 3,
    schema: { hasBodyField: true, defaultProminence: null },
  };
  const view = React.createElement(MarkdownCardView, { data, onNavigate: () => undefined, mode: "page" });
  const element = React.createElement(BoxSlugProvider, { boxSlug: "test1" }, view);
  const root = createRootRoute({ staticData: { title: null }, component: () => element });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  const queryClient = new QueryClient();
  return renderToStaticMarkup(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(RouterProvider, { router })));
}
```

```ts
const repeated = await renderCard("# Trip Report\n\nWe drove down on Friday.\n\n{% todo %}Return the van{% /todo %}\n");
[repeated.includes("<h1"), repeated.includes("We drove down"), /data-todo-locator="(\d+)"/.exec(repeated)?.[1]]
=> [false, true, "8"]
```

A different first heading stays:

```ts
(await renderCard("# Day one\n\nWe drove down on Friday.\n")).includes("Day one</h1>")
=> true
```
