# The app bar's landmark menu

The place pill has two menus (docs/plans/box-screen.md, track 3). The landmark
menu says where the conversation is and where it can move; the folder menu
holds the current landmark's directory and what is in it. Box-wide pages live
on the box screen, which the landmark menu's box row opens.

```ts setup
import * as React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { createTRPCClient } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { trpc } from "../../../src/lib/trpc/client.js";
import { SwitchMenuBody } from "../../../src/components/AppNav/PlacePill-panels.js";

globalThis.React = React;

/** Render a menu body inside a router and a tRPC client that never answers. */
async function render(element) {
  const root = createRootRoute({ staticData: { title: null }, component: () => element });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  const queryClient = new QueryClient();
  const client = createTRPCClient({ links: [() => () => observable(() => () => {})] });
  return renderToString(React.createElement(trpc.Provider, { client, queryClient },
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(RouterProvider, { router }))));
}

/** Each menu row as `id: text → href`, in order. */
function rows(html) {
  return [...html.matchAll(/<(a|button)\b[^>]*role="menuitem"[^>]*>(.*?)<\/\1>/g)].map(([tag, , body]) => {
    const id = /\bid="([^"]*)"/.exec(tag)?.[1] ?? "-";
    const href = /\bhref="([^"]*)"/.exec(tag)?.[1];
    const text = body.replace(/<[^>]*>/g, "").replace(/&rsquo;/g, "’");
    return href === undefined ? `${id}: ${text}` : `${id}: ${text} → ${href}`;
  });
}

const landmarks = [
  { path: "", dir: "", label: "Box root", symbol: { glyph: "🏠" }, freshCount: 0 },
  { path: "garden/Garden.landmark.card", dir: "garden", label: "Garden", symbol: null, freshCount: 2 },
];
const noop = () => {};
```

## Landmark menu

The box row opens the box screen. It is a plain document navigation, so the
native shell can intercept it; "Find a landmark" opens the Landmarks page.
There is no box panel, no Recent files row, and no shortcut rows: those moved
to the box screen and the folder menu.

```ts
rows(await render(React.createElement(SwitchMenuBody, {
  boxSlug: "test1", boxName: "Test box", currentDir: "garden", landmarks, landmarksFailed: false,
  onRetryLandmarks: noop, problemCount: 1, onSelectLandmark: noop,
})))
=> [
  "bbx-switch-menu-box: Box: Test box → /test1/box",
  "bbx-switch-menu-landmarks: Find a landmark → /test1/views/_config/interface/landmarks.card",
  "bbx-switch-menu-landmark-first: 🏠Box root",
  "-: 📍Garden✓(current)2",
  "bbx-switch-menu-problems: ⚠ 1 landmark card didn’t parse → /test1/views/_config/interface/landmarks.card",
]
```

## Folder menu

The folder menu is the directory, Search, Recent files on a chat page, and the
landmark's links; the landmark card is not a row, because the agent edits it.
Both of its bodies (`HereMenuBody` outside a chat, the chat's
`ContextMenuBody`) need the workspace and the Markdown renderer, which do not
load under plain Node, so they are checked in the browser walk.
