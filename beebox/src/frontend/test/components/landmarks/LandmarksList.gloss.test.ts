// # The Landmarks page glosses its word
//
// "Landmark" is kept as a word (glossary, "landmark"); the page says what it
// means under its title: "The places you jump to most." The app bar's "Find a
// landmark" row carries the same gloss (docs/plans/front-door.md, Track E;
// `AppNav/PlacePill.menus.test.ts`). These render the page with its two
// queries already answered.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { createTRPCClient } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "@backend/trpc/routers.js";
import { trpc, type RouterOutput } from "../../../src/lib/trpc/client.js";
import { LandmarksList } from "../../../src/components/landmarks/LandmarksList.js";

globalThis.React = React;

/** Render the page with `landmarks.list` and `chat.byLandmark` seeded. */
async function render(list: RouterOutput["landmarks"]["list"], chats: RouterOutput["chat"]["byLandmark"]) {
  const root = createRootRoute({ staticData: { title: null }, component: () => React.createElement(LandmarksList) });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  const queryClient = new QueryClient();
  queryClient.setQueryData([["landmarks", "list"], { type: "query" }], list);
  queryClient.setQueryData([["chat", "byLandmark"], { type: "query" }], chats);
  const client = createTRPCClient<AppRouter>({ links: [() => () => observable(() => () => {})] });
  return renderToString(React.createElement(trpc.Provider, {
    client, queryClient,
    children: React.createElement(QueryClientProvider, { client: queryClient, children: React.createElement(RouterProvider, { router }) }),
  }));
}

/** The first paragraph's text. */
function firstParagraph(html: string) {
  return /<p[^>]*>([^<]*)<\/p>/.exec(html)?.[1] ?? null;
}

// A box with one landmark card that did not parse still shows the page, and
// the gloss comes first.
void test("A box with one landmark card that did not parse still shows the page", async (t) => {
  const problems = [{ kind: "landmark-parse" as const, path: "_content/garden/Garden.landmark.card" }];
  const html = await render(
    { landmarks: [], problems },
    { landmarks: [], unassigned: { sessions: [], olderSessions: [], freshCount: 0, latestActivity: null, dead: [] }, freshCount: 0, problems },
  );
  t.check(firstParagraph(html), "The places you jump to most.");
});
