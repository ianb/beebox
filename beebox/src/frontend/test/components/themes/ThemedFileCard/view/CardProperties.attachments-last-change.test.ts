// # Card Properties: attachments and last change
//
// Two Properties sections, mounted only while the back of the card is shown
// (`CardThemeSurface` renders `properties` only when `back` is true).
// `CardAttachments` lists the card's attach scope, `<basename>.attach/`, which
// `attachDirFor` (`src/shared/attach-path.ts`) computes. `CardLastChange` names
// the newest commit touching the card and links to the History card.

import { test } from "tap";
import "agent-doctest/tap";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { createTRPCClient } from "@trpc/client";
import { getQueryKey } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import { trpc } from "../../../../../src/lib/trpc/client.js";
import type { RouterOutput } from "../../../../../src/lib/trpc/client.js";
import type { AppRouter } from "@backend/trpc/routers.js";
import { CardAttachments, attachmentEntries } from "../../../../../src/components/themes/ThemedFileCard/view/CardAttachments.js";
import { CardLastChange } from "../../../../../src/components/themes/ThemedFileCard/view/CardLastChange.js";

globalThis.React = React;

const cardPath = "_content/projects/Porch.doc.card";

/**
 * Render a section at `/test1` (the box slug) inside a router and a tRPC
 * client that never answers, with the query cache seeded by `seed(queryClient)`.
 */
async function render(element: React.ReactElement, seed?: (queryClient: QueryClient) => void): Promise<string> {
  const root = createRootRoute({ staticData: { title: null } });
  const box = createRoute({ getParentRoute: () => root, path: "$boxSlug", staticData: { title: null }, component: () => element });
  const router = createRouter({ routeTree: root.addChildren([box]), history: createMemoryHistory({ initialEntries: ["/test1"] }) });
  await router.load();
  const queryClient = new QueryClient();
  seed?.(queryClient);
  const client = createTRPCClient<AppRouter>({ links: [() => () => observable(() => () => {})] });
  return renderToString(React.createElement(trpc.Provider, {
    client,
    queryClient,
    children: React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(RouterProvider, { router })),
  }));
}

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/<!-- -->/g, "").replace(/\s+/g, " ").trim();
}

const noop = () => {};
const scope = "_content/projects/Porch.attach";
const emptyListing: RouterOutput["status"]["browse"] = { path: scope, dirs: [], cards: [], files: [], background: false };

/** Seed the attach scope's `status.browse` answer. */
function listing(answer: RouterOutput["status"]["browse"]) {
  return (queryClient: QueryClient) => { queryClient.setQueryData(getQueryKey(trpc.status.browse, { path: scope }, "query"), answer); };
}

// ## The attach scope
//
// The scope listing becomes one list of links: subdirectories first, then cards, then
// other files, each labelled by its path inside the scope.
void test("The scope listing becomes one list of links:", async (t) => {
  // doctest:L66
  t.check(
    attachmentEntries("_content/projects/Porch.attach", {
      dirs: [{ name: "scans", fileCount: 2, summary: { background: false, hasEntryPoint: false, primaryCount: 0 } }],
      cards: [{ relativePath: "_content/projects/Porch.attach/Quote.doc.card", name: "Quote", type: "doc", prominence: "ordinary" }],
      files: [{ relativePath: "_content/projects/Porch.attach/photo.jpg", name: "photo.jpg" }],
    }),
    [
    {
      path: "_content/projects/Porch.attach/scans",
      label: "scans/",
    },
    {
      path: "_content/projects/Porch.attach/Quote.doc.card",
      label: "Quote.doc.card",
    },
    {
      path: "_content/projects/Porch.attach/photo.jpg",
      label: "photo.jpg",
    },
  ],
  );
});

// ## Attachments section
//
// `status.browse` answers a missing directory with an empty listing, so an
// empty listing is the "No attachments" state:
void test("status.browse answers a missing directory with an empty listing, so an empty...", async (t) => {
  // doctest:L84
  t.check(textOf(await render(React.createElement(CardAttachments, { path: cardPath, onNavigate: noop }), listing(emptyListing))), "Attachments No attachments");
});

// With entries, the heading counts them and each is a link with a real href:
void test("With entries, the heading counts them and each is a link with a real href:", async (t) => {
  // doctest:L91
  const html = await render(React.createElement(CardAttachments, { path: cardPath, onNavigate: noop }), listing({
    ...emptyListing, files: [{ relativePath: `${scope}/photo.jpg`, name: "photo.jpg" }],
  }));
  t.check([textOf(html), /href="([^"]*)"/.exec(html)?.[1]], [
    "Attachments (1) photo.jpg",
    "/test1/views/_content/projects/Porch.attach/photo.jpg",
  ]);
});

// While the listing loads, the section says so:
void test("While the listing loads, the section says so:", async (t) => {
  // doctest:L101
  t.check(textOf(await render(React.createElement(CardAttachments, { path: cardPath, onNavigate: noop }))), "Attachments Checking attachments…");
});

// ## Changed section
//
// A card with no commits yet says so, and offers no History link:
void test("A card with no commits yet says so, and offers no History link:", async (t) => {
  // doctest:L110
  const changed = await render(React.createElement(CardLastChange, { path: cardPath, onNavigate: noop }), (queryClient: QueryClient) => {
    queryClient.setQueryData(getQueryKey(trpc.history.list, { filter: { path: cardPath }, count: 1 }, "query"), { commits: [], nextCursor: undefined });
  });
  t.check([textOf(changed), changed.includes("<a")], [
    "Changed Not committed yet",
    false,
  ]);
});

// With a commit, the line carries the full date as its tooltip, and "History"
// links to the History card filtered to this card's path:
void test("With a commit, the line carries the full date as its tooltip, and \"History\" l...", async (t) => {
  // doctest:L121
  const committed = await render(React.createElement(CardLastChange, { path: cardPath, onNavigate: noop }), (queryClient: QueryClient) => {
    queryClient.setQueryData(getQueryKey(trpc.history.list, { filter: { path: cardPath }, count: 1 }, "query"),
      { commits: [{ hash: "abc123", date: "2026-10-03T09:30:00Z", subject: "Add porch quotes" }], nextCursor: undefined });
  });
  const historyHref = decodeURIComponent(/href="([^"]*)"/.exec(committed)?.[1] ?? "");
  t.check([/title="([^"]*)"/.exec(committed)?.[1], textOf(committed).endsWith("· Add porch quotes History"), historyHref.includes(`"path":"${cardPath}"`)], [
    "2026-10-03T09:30:00Z",
    true,
    true,
  ]);
});
