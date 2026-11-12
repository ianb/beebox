// # A MenuItem link carries the router props the menus use
//
// The session rows link to `/<box>/chat` with a `search` (the session and, for
// a search hit, the message anchor), a `title`, and a `data-bbx-source` tag
// (docs/implemented-plans/ui-primitives-dedup.md, Track 7, "MenuItem links and actions").

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { MenuItem } from "../../../src/components/ui/menu-item.js";
import { toSearch } from "../../../src/lib/routing.js";

globalThis.React = React;

async function render(element: React.ReactElement): Promise<string> {
  const root = createRootRoute({ staticData: { title: null }, component: () => element });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/test1/chat"] }) });
  await router.load();
  return renderToString(React.createElement(RouterProvider, { router }));
}

void test("to, search, hash, title and data-* reach the rendered link", async (t) => {
  const html = await render(React.createElement(MenuItem, {
    to: "/test1/chat",
    search: toSearch({ session: "abc", m: "m-7" }),
    hash: "end",
    title: "Session abc",
    "data-bbx-source": "session:abc",
    children: "Morning chat",
  }));
  const anchor = /<a\b([^>]*)>/.exec(html)?.[1] ?? "";
  const attrs = Object.fromEntries([...anchor.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
  t.check(
    { href: attrs.href, title: attrs.title, source: attrs["data-bbx-source"], role: attrs.role },
    { href: "/test1/chat?session=abc&amp;m=m-7#end", title: "Session abc", source: "session:abc", role: "menuitem" },
  );
});
