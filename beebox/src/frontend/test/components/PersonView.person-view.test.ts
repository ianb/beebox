// # The person front
//
// A person card's front leads with what the card says about the person: role,
// contact details, other names, then the notes body. The fields Properties lists
// are not repeated as a table, and the header already shows the name.

import { test } from "tap";
import "agent-doctest/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { PersonView } from "../../src/components/PersonView/view.js";
import { BoxSlugProvider } from "../../src/lib/box-slug.js";
import type { RendererProps } from "../../src/file-type-registry.js";
import type { CardSchemaFacts } from "@backend/trpc/routers/card.js";

globalThis.React = React;

/** Tags become " | " (after a closing tag) or a space; runs of separators collapse. */
function visibleText(html: string): string {
  return html
    .replace(/<\/(p|div|dd|span)>/g, "$&|")
    .replace(/<[^>]*(?:>|$)/g, " ")
    .replace(/[\s|]*\|[\s|]*/g, " | ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\| | \|$/g, "");
}

interface PersonRenderOptions {
  body: string;
  mode?: RendererProps["mode"];
  schema?: CardSchemaFacts | null;
}

const ordinaryPersonSchema: CardSchemaFacts = { hasBodyField: true, defaultProminence: "ordinary" };

/** Render a person card's front inside a router and a query client that never answers. */
async function renderPerson(frontmatter: Record<string, unknown>, { body, mode, schema }: PersonRenderOptions) {
  const data = {
    path: "_content/people/Rosa_Quill.person.card",
    frontmatter,
    body,
    bodyLineOffset: 4,
    schema: schema === undefined ? ordinaryPersonSchema : schema,
  };
  const view = React.createElement(PersonView, { data, onNavigate: () => {}, mode: mode ?? "page" });
  const element = React.createElement(BoxSlugProvider, { boxSlug: "test1", children: view });
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

// ## A boxholder with every contact
//
// The role line carries a "Boxholder" badge. Email and phone are links that
// start a message or a call; the address is text. Aliases read "Also: …". A
// body opening with `# <name>` loses that heading, as a doc's body does with its
// title.
void test("The role line carries a \"Boxholder\" badge.", async (t) => {
  // doctest:L63
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
    { body: "# Rosa Quill\n\nKeeps the family letters.\n" },
  );
  t.check([rosa.summary, rosa.links, rosa.hasTable, rosa.html.includes("<h1"), rosa.html.includes("Keeps the family letters.")], [
    "Archivist | Boxholder | Email rosa@example.com | Phone +44 20 7946 0000 | Address 12 Harbour Lane, Portsmouth | Also: Ro, The Quill",
    [
      "mailto:rosa@example.com",
      "tel:+442079460000",
    ],
    false,
    false,
    true,
  ]);
});

// ## Name and body only
//
// Absent fields leave no rows, labels, or empty table behind; the front is the
// body.
void test("Absent fields leave no rows, labels, or empty table behind; the front is the...", async (t) => {
  // doctest:L85
  const plain = await renderPerson({ name: "Charles Babbage" }, { body: "Built the Difference Engine.\n" });
  t.check([plain.summary, plain.links, plain.hasTable, plain.html.includes("Built the Difference Engine.")], [
    null,
    [],
    false,
    true,
  ]);
});

// ## Archived
//
// An archived person says so on the role line, with or without a role.
void test("An archived person says so on the role line, with or without a role.", async (t) => {
  // doctest:L95
  t.check((await renderPerson({ name: "Old Contact", role: "Former landlord", archived: true }, { body: "Moved away.\n" })).summary, "Former landlord | Archived");

  // doctest:L98
  t.check((await renderPerson({ name: "Old Contact", archived: true }, { body: "" })).summary, "Archived");
});

// ## Fields the person rows do not draw
//
// `todos` belongs on every front, so it renders in the shared table. An embedded
// person has no header, so the name shows. A card whose schema is unknown keeps
// an unexpected field on the front rather than hiding it.
void test("todos belongs on every front, so it renders in the shared table.", async (t) => {
  // doctest:L109
  const todo = await renderPerson({ name: "Rosa Quill", todos: [{ text: "Send the notes" }] }, { body: "Notes.\n" });
  t.check([todo.hasTable, todo.html.includes("Send the notes")], [
    true,
    true,
  ]);

  // doctest:L113
  t.check((await renderPerson({ name: "Rosa Quill", role: "Archivist" }, { body: "Notes.\n", mode: "embed" })).summary, "Rosa Quill | Archivist");

  // doctest:L116
  const unknown = await renderPerson({ name: "Rosa Quill", email: 42, nickname: "AL" }, { body: "Notes.\n", schema: null });
  t.check([unknown.summary, unknown.html.includes('field-label">Email<'), unknown.html.includes('field-label">Nickname<'), unknown.html.includes('field-label">Name<')], [
    null,
    true,
    true,
    false,
  ]);
});

// The table reads like the rest of the card: a label is the key in sentence
// case, and a small object that names someone reads as the name with its role
// beside it.
void test("The table reads like the rest of the card:", async (t) => {
  // doctest:L126
  const employer = await renderPerson({ name: "Rosa Quill", "day-job": { name: "Harbour Archive", role: "volunteer" } }, { body: "Notes.\n", schema: null });
  t.check(/data-card-section="frontmatter">(.*?)<\/dl>/s.exec(employer.html)?.[1]?.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|"), "|Day job|Harbour Archive| (volunteer)|");
});

// ## Booleans that are not drawn stay visible
//
// `boxholder` and `archived` are drawn only when they are `true`. Any other
// value is not drawn, so with an unknown schema it falls through to the table
// instead of vanishing.
void test("boxholder and archived are drawn only when they are true.", async (t) => {
  // doctest:L138
  const odd = await renderPerson({ name: "Rosa Quill", boxholder: "yes", archived: false }, { body: "Notes.\n", schema: null });
  t.check([odd.summary, odd.html.includes('field-label">Boxholder<'), odd.html.includes('field-label">Archived<')], [
    null,
    true,
    true,
  ]);
});

// ## Phone numbers with an extension are not dialled
void test("Phone numbers with an extension are not dialled", async (t) => {
  // doctest:L146
  const { telHref } = await import("../../src/components/PersonView/view.js");

  // doctest:L148
  t.check([telHref("+1 (555) 010-0100"), telHref("+1 (555) 010-0100 x12"), telHref("ext. 4"), telHref("—")], [
    "tel:+15550100100",
    null,
    null,
    null,
  ]);

  // doctest:L151
  t.check((await renderPerson({ name: "Rosa Quill", phone: "+1 (555) 010-0100 x12" }, { body: "" })).links, []);
});
