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

const cardPath = "_content/projects/Porch.doc.card";
const todos = [
  { text: "Book the inspector", due: "2026-09-15" },
  { text: "Summarize the quotes", assigned: "agent", status: "done" },
  { text: "Order lumber", status: "done" },
];

function renderFields(fields: Record<string, unknown>, context?: React.ContextType<typeof CardTodosContext>): string {
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

fm.includes("Summarize the quotes") || fm.includes('field-label">Text<')
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

## Fields read as a person reads them

A label is the key in sentence case, with no colon
(`test/lib/readable-fields.doctest.md`). A small object reads as one value: a
person's name links to their card with the role beside it in parentheses,
and a measure reads as its value with its note.

```ts setup
/** The visible text of each `<dt>`/`<dd>` cell, in order, "|"-separated. */
function cells(html: string): string {
  return html.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|");
}
```

```ts
const record = renderFields({
  "back-by": "2026-10-20",
  lender: { name: "Idris", ref: "../people/Idris_Okafor.person.card", role: "lender" },
  quantity: { value: "1 stove", note: "missing lid" },
});
[cells(record), /<button[^>]*>Idris<\/button>/.test(record)]
=> ["|Back by|2026-10-20|Lender|Idris| (lender)|Quantity|1 stove| (missing lid)|", true]
```

A `ref` beside `text` can be the evidence for the text, as in a guide's
observation, so the text is not made a link and both keep their own rows. An
extra key the rule does not know keeps its row too.

```ts
cells(renderFields({ observation: { text: "Water pools by the door", ref: "../notes/Rain.note.card" } }))
=> |Observation|Text|Water pools by the door|Ref|../notes/Rain.note.card|

cells(renderFields({ length: { value: "3", unit: "m" } }))
=> |Length|Value|3|Unit|m|
```

A web address that reads as one value stays a link, as a bare URL field
does.

```ts
/<a href="https:\/\/maps\.example\/shelf"[^>]*>https:\/\/maps\.example\/shelf<\/a>/.test(renderFields({ location: { text: "https://maps.example/shelf" } }))
=> true
```

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
import type { FileData } from "../../src/file-type-registry.js";
import { MarkdownCardView } from "../../src/components/MarkdownCardView/view.js";
import { BoxSlugProvider } from "../../src/lib/box-slug.js";

/** Render a doc card's view inside a router and a query client that never answers. */
async function renderCard(body: string): Promise<string> {
  const data: FileData = {
    path: "_content/Trip.doc.card",
    frontmatter: { title: "Trip Report" },
    body,
    bodyLineOffset: 3,
    schema: { hasBodyField: true, defaultProminence: "ordinary" },
  };
  const view = React.createElement(MarkdownCardView, { data, onNavigate: () => undefined, mode: "page" });
  const element = React.createElement(BoxSlugProvider, { boxSlug: "test1", children: view });
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

## An empty bodied card shows its fields, not "No body content"

A record with only fields and an empty body shows its type fields on the
front (`splitCardFields` with `bodyEmpty`), and the front says nothing about
the missing body. A body that is only the repeated title heading counts as
empty.

```ts setup
async function renderRecord(body: string): Promise<string> {
  const data: FileData = {
    path: "_content/inventory/Solder.record.card",
    frontmatter: { title: "Solder", location: { text: "Tray 3" } },
    body,
    schema: { hasBodyField: true, defaultProminence: "ordinary" },
  };
  const view = React.createElement(MarkdownCardView, { data, onNavigate: () => undefined, mode: "page" });
  const element = React.createElement(BoxSlugProvider, { boxSlug: "test1", children: view });
  const root = createRootRoute({ staticData: { title: null }, component: () => element });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  return renderToStaticMarkup(React.createElement(QueryClientProvider, { client: new QueryClient() }, React.createElement(RouterProvider, { router })));
}
```

```ts
const empty = await renderRecord("# Solder\n");
[empty.includes('data-card-section="frontmatter"'), empty.includes("Tray 3"), empty.includes("No body content")]
=> [true, true, false]
```

The front reads "Location" and "With Idris", with no nested "Text" row and
no "Name" row: a record is headed by its `name:`, which the header already
shows. A card headed by something else (its `title:`) keeps the `name` row.

```ts
async function renderFront(frontmatter: Record<string, unknown>): Promise<string | null> {
  const data: FileData = { path: "_content/lending/Camp_stove.record.card", frontmatter, body: "", schema: { hasBodyField: true, defaultProminence: "ordinary" } };
  const view = React.createElement(MarkdownCardView, { data, onNavigate: () => undefined, mode: "page" });
  const element = React.createElement(BoxSlugProvider, { boxSlug: "test1", children: view });
  const root = createRootRoute({ staticData: { title: null }, component: () => element });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client: new QueryClient() }, React.createElement(RouterProvider, { router })));
  const section = /data-card-section="frontmatter">(.*?)<\/dl>/s.exec(html);
  return section === null ? null : cells(section[1] ?? "");
}

await renderFront({ name: "Camp stove", location: { text: "With Idris" }, quantity: { value: "1 stove" } })
=> |Location|With Idris|Quantity|1 stove|

await renderFront({ title: "Stove", name: "Camp stove", location: { text: "With Idris" } })
=> |Name|Camp stove|Location|With Idris|
```

A record with only its name has nothing beside the header, so the front draws
no empty field section.

```ts continue
await renderFront({ name: "Camp stove" })
=> null
```

With a body, the fields stay in Properties:

```ts
const full = await renderRecord("Lead-free, 0.8mm.\n");
[full.includes('data-card-section="frontmatter"'), full.includes("Tray 3"), full.includes("Lead-free")]
=> [false, false, true]
```

## An embed reads title, summary line, body, then fields

A card embedded in chat has no header, so the view draws the title and the
type's summary line, then the body, then the field block
(docs/implemented-plans/place-shows-cards.md, Track B). The title shows once: it is not
also a row in the field block, and a body heading that repeats it is hidden.
A record is titled by its `name:`.

```ts setup
async function renderEmbed(data: FileData): Promise<string> {
  const view = React.createElement(MarkdownCardView, { data, onNavigate: () => undefined, mode: "embed" });
  const element = React.createElement(BoxSlugProvider, { boxSlug: "test1", children: view });
  const root = createRootRoute({ staticData: { title: null }, component: () => element });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  return renderToStaticMarkup(React.createElement(QueryClientProvider, { client: new QueryClient() }, React.createElement(RouterProvider, { router })));
}

/** The `data-card-section` names in page order. */
function sectionOrder(html: string): Array<string | undefined> {
  return [...html.matchAll(/data-card-section="([^"]*)"/g)].map((m) => m[1]);
}
```

```ts
const html = await renderEmbed({
  path: "_content/inventory/Solder.record.card",
  frontmatter: { name: "Solder", location: { text: "Tray 3" }, quantity: { value: "2 spools" } },
  body: "# Solder\n\nLead-free, 0.8mm.\n",
  detail: "Tray 3 · 2 spools",
  schema: { hasBodyField: true, defaultProminence: "ordinary" },
});
[sectionOrder(html), html.split("Solder<").length - 1, html.includes("Tray 3 · 2 spools"), html.includes("Lead-free")]
=> [["heading", "body", "frontmatter"], 1, true, true]
```

A page shows the same card with its fields in Properties and no heading of
its own; the card header has the title.

```ts
const page = await renderCard("Lead-free, 0.8mm.\n");
sectionOrder(page)
=> ["body"]
```
