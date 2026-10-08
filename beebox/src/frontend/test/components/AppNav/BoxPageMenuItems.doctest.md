# The box-wide pages in the avatar menu

Dashboard, Browse, History, and Storage summary are rows of the avatar menu,
below Settings and Admin (docs/plans/box-screen.md, "Box-wide pages move to
the avatar menu"). The boxholder never opened them from the box screen. The
rows keep the ids of the old box panel, so smoke snapshots and docs keep one
name for each.

```ts setup
import * as React from "react";
import { renderToString } from "react-dom/server";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { BoxPageMenuItems } from "../../../src/components/AppNav/BoxPageMenuItems.js";

globalThis.React = React;

/** Render the rows at `path`, each as `id: text → href`, with `(active)` on the highlighted row. */
async function rows(path) {
  const root = createRootRoute({ staticData: { title: null }, component: () => React.createElement(BoxPageMenuItems, { boxSlug: "test1" }) });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: [path] }) });
  await router.load();
  const html = renderToString(React.createElement(RouterProvider, { router }));
  return [...html.matchAll(/<a\b([^>]*)>(.*?)<\/a>/g)].map(([, attrs, body]) => {
    const id = /\bid="([^"]*)"/.exec(attrs)?.[1];
    const href = /\bhref="([^"]*)"/.exec(attrs)?.[1];
    const active = /\bfont-medium\b/.test(attrs) ? " (active)" : "";
    return `${id}: ${body.replace(/<[^>]*>/g, "")} → ${href}${active}`;
  });
}
```

Each row opens its system card under `/<box>/views/`. On a chat page none is
highlighted.

```ts
await rows("/test1/chat")
=> [
  "bbx-box-menu-dashboard: Dashboard → /test1/views/_config/interface/dashboard.card",
  "bbx-box-menu-browse: Browse → /test1/views/_config/interface/browse.card",
  "bbx-box-menu-history: History → /test1/views/_config/interface/history.card",
  "bbx-box-menu-inventory: Storage summary → /test1/views/_config/interface/inventory.card",
]
```

On one of the pages, its row is highlighted, as the Settings and Admin rows
are on theirs.

```ts
(await rows("/test1/views/_config/interface/history.card")).filter((row) => row.endsWith("(active)"))
=> ["bbx-box-menu-history: History → /test1/views/_config/interface/history.card (active)"]
```
