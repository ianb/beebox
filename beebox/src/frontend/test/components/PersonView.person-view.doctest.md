# The person front

A person card's front leads with what the card says about the person: role,
contact details, other names, then the notes body. The fields Properties lists
are not repeated as a table, and the header already shows the name.

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { PersonView } from "../../src/components/PersonView/view.js";
import { BoxSlugProvider } from "../../src/lib/box-slug.js";

globalThis.React = React;

/** Tags become " | " (after a closing tag) or a space; runs of separators collapse. */
function visibleText(html) {
  return html
    .replace(/<\/(p|div|dd|span)>/g, "$&|")
    .replace(/<[^>]*(?:>|$)/g, " ")
    .replace(/[\s|]*\|[\s|]*/g, " | ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\| | \|$/g, "");
}

/** Render a person card's front inside a router and a query client that never answers. */
async function renderPerson(frontmatter, body, { mode = "page", schema = { hasBodyField: true, defaultProminence: null } } = {}) {
  const data = { path: "_content/people/Rosa_Quill.person.card", frontmatter, body, bodyLineOffset: 4, schema };
  const view = React.createElement(PersonView, { data, onNavigate: () => undefined, mode });
  const element = React.createElement(BoxSlugProvider, { boxSlug: "test1" }, view);
  const root = createRootRoute({ staticData: { title: null }, component: () => element });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client: new QueryClient() }, React.createElement(RouterProvider, { router })));
  // The person rows run from their section marker to the next section (fields table or body).
  const person = /data-card-section="person">(.*?)(?:data-card-section="|$)/s.exec(html)?.[1];
  return {
    html,
    /** The person rows' visible text, one " | " after each closing element. */
    summary: person === undefined ? null : visibleText(person),
    links: [...html.matchAll(/href="((?:mailto|tel):[^"]*)"/g)].map((m) => m[1]),
    hasTable: html.includes('data-card-section="frontmatter"'),
  };
}
```

## A boxholder with every contact

The role line carries a "Boxholder" badge. Email and phone are links that
start a message or a call; the address is text. Aliases read "Also: …". A
body opening with `# <name>` loses that heading, as a doc's body does with its
title.

```ts
const rosa = await renderPerson(
  {
    name: "Rosa Quill",
    aliases: ["Ro", "The Quill"],
    role: "Archivist",
    boxholder: true,
    email: "rosa@example.com",
    phone: "+44 20 7946 0000",
    address: "12 Harbour Lane, Portsmouth",
  },
  "# Rosa Quill\n\nKeeps the family letters.\n",
);
[rosa.summary, rosa.links, rosa.hasTable, rosa.html.includes("<h1"), rosa.html.includes("Keeps the family letters.")]
=> ["Archivist | Boxholder | Email rosa@example.com | Phone +44 20 7946 0000 | Address 12 Harbour Lane, Portsmouth | Also: Ro, The Quill", ["mailto:rosa@example.com", "tel:+442079460000"], false, false, true]
```

## Name and body only

Absent fields leave no rows, labels, or empty table behind; the front is the
body.

```ts
const plain = await renderPerson({ name: "Charles Babbage" }, "Built the Difference Engine.\n");
[plain.summary, plain.links, plain.hasTable, plain.html.includes("Built the Difference Engine.")]
=> [null, [], false, true]
```

## Archived

An archived person says so on the role line, with or without a role.

```ts
(await renderPerson({ name: "Old Contact", role: "Former landlord", archived: true }, "Moved away.\n")).summary
=> Former landlord | Archived

(await renderPerson({ name: "Old Contact", archived: true }, "")).summary
=> Archived
```

## Fields the person rows do not draw

`todos` belongs on every front, so it renders in the shared table. An embedded
person has no header, so the name shows. A card whose schema is unknown keeps
an unexpected field on the front rather than hiding it.

```ts
const todo = await renderPerson({ name: "Rosa Quill", todos: [{ text: "Send the notes" }] }, "Notes.\n");
[todo.hasTable, todo.html.includes("Send the notes")]
=> [true, true]

(await renderPerson({ name: "Rosa Quill", role: "Archivist" }, "Notes.\n", { mode: "embed" })).summary
=> Rosa Quill | Archivist

const unknown = await renderPerson({ name: "Rosa Quill", email: 42, nickname: "AL" }, "Notes.\n", { schema: null });
[unknown.summary, unknown.html.includes(">email:<"), unknown.html.includes(">nickname:<"), unknown.html.includes(">name:<")]
=> [null, true, true, false]
```
