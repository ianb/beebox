# The box screen mounts no chat

The box screen exists so a thought goes in before any chat loads
(docs/plans/box-screen.md, track 2). `ProductLayout` mounts the conversation
shell for every page whose route does not declare `staticData.standalone`;
`useStandalonePage` (`main/standalone-page.ts`) is that check. This test builds
a router from the box screen's real route options (`pages/box-screen/route.ts`) and the real page, with a
stand-in for the shell, and renders `/test1/box`. The app's own router cannot
load under plain Node (its Markdown renderer needs Vite's module interop), so
the stand-in layout calls the same hook `ProductLayout` calls.

```ts setup
import * as React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { createTRPCClient } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { trpc } from "../../../src/lib/trpc/client.js";
import { useStandalonePage } from "../../../src/main/standalone-page.js";
import { boxScreenRouteOptions } from "../../../src/pages/box-screen/route.js";
import { BoxScreenPage } from "../../../src/pages/box-screen/BoxScreenPage.js";

globalThis.React = React;

/** Render `path` and report what mounted and which queries the page subscribed to. */
async function render(path: string) {
  let shellMounts = 0;
  function ConversationShell() { shellMounts += 1; return null; }
  function Layout() {
    return React.createElement("main", null, useStandalonePage() ? null : React.createElement(ConversationShell), React.createElement(Outlet));
  }
  const root = createRootRoute({ staticData: { title: null } });
  const box = createRoute({ staticData: { title: null }, getParentRoute: () => root, path: "/$boxSlug" });
  const product = createRoute({ staticData: { title: null }, getParentRoute: () => box, id: "product", component: Layout });
  const screen = createRoute({ ...boxScreenRouteOptions, getParentRoute: () => product, component: BoxScreenPage });
  const chat = createRoute({ staticData: { title: "Chat" }, getParentRoute: () => product, path: "/chat", component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([box.addChildren([product.addChildren([screen, chat])])]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  const queryClient = new QueryClient();
  queryClient.setQueryData(["boxes"], { boxes: [{ slug: "test1", name: "Test box" }] });
  // A link that never answers: the render records which procedures it asked for.
  const client = createTRPCClient({ links: [() => () => observable(() => () => {})] });
  const html = renderToString(
    React.createElement(trpc.Provider, { client, queryClient },
      React.createElement(QueryClientProvider, { client: queryClient },
        React.createElement(RouterProvider, { router }))),
  );
  const procedures = queryClient.getQueryCache().getAll()
    .map((query) => query.queryKey[0])
    .filter((key) => Array.isArray(key))
    .map((key) => key.join("."));
  return { html, shellMounts, procedures };
}
```

The box screen renders its own sections and input. The conversation shell
never mounts, and the only procedure the page subscribes to is
`quickChat.home`: no `chat.*` query at all.

```ts
const page = await render("/test1/box");
[page.shellMounts, page.procedures]
=> [0, ["quickChat.home"]]

["Pick up where you left off", "New thought. The box picks the conversation."].filter((text) => !page.html.includes(text))
=> []
```

The box-wide pages are not on the box screen: they are in the avatar menu.
The "Shortcuts" section shows only the box's `nav.card` entries, so it is
absent until `quickChat.home` answers with at least one.

```ts continue
["In this box", "Dashboard", "Storage summary", "Shortcuts"].filter((text) => page.html.includes(text))
=> []
```

The same layout mounts the shell for an ordinary page, so the check above is
the route's declaration at work and not a shell that never renders:

```ts
(await render("/test1/chat")).shellMounts
=> 1
```
