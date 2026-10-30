// # The Browser row in the avatar menu
//
// The avatar menu has a "Browser" row after Admin that opens the box's shared
// browser at `/<box>/browser/` in a new tab (docs/plans/shared-browser.md,
// Track E). The page is served by the engine, not the app's router, so the row
// is a plain link: a router link would try to render the path inside the app.

// First, and bare: React DOM must load after the happy-dom window exists.
import { byId, byRole, mount } from "../../helpers/dom-harness.js";
import * as React from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { ProfileMenu } from "../../../src/components/AppNav/nav.js";

globalThis.React = React;

void test("The Browser row follows Admin and opens /<box>/browser/ in a new tab", async (t) => {
  const menu = React.createElement(ProfileMenu, { user: null, boxSlug: "test1", onToggleDebugLog: () => {}, onToggleSourceView: () => {} });
  const root = createRootRoute({ staticData: { title: null }, component: () => menu });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/test1/chat"] }) });
  await router.load();
  const view = await mount(React.createElement(RouterProvider, { router }));
  t.teardown(() => view.unmount());
  await view.act(() => { byRole(view.container, { role: "button", name: "Menu" }).click(); });
  // The open menu is portalled to the document body.
  const row = byId(document.body, "bbx-profile-menu-browser");
  t.check(
    {
      text: row.textContent,
      href: row.getAttribute("href"),
      target: row.getAttribute("target"),
      rel: row.getAttribute("rel"),
      after: row.previousElementSibling?.id,
    },
    { text: "Browser", href: "/test1/browser/", target: "_blank", rel: "noopener noreferrer", after: "bbx-profile-menu-admin" },
  );
});

