// # Card Properties: section order and the Appearance row
//
// `ThemedFileCardProperties` is the back of a card. `CardThemeSurface` mounts it
// only while the back is shown, so its local state, including the open state of
// the Appearance disclosure, starts fresh on each open.
//
// It reads top to bottom: where the card is filed and its type, how it is found,
// its type fields, what it carries, when it last changed, who mentions it, its
// appearance, its alternate views, then the actions menu.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { createTRPCClient } from "@trpc/client";
import { getQueryKey } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "@backend/trpc/routers.js";
import type { FileData, FileRenderer } from "../../../../../src/file-type-registry.js";
import { trpc } from "../../../../../src/lib/trpc/client.js";
import { resolveCardTheme } from "@shared/card-theme/core";
import { BoxPresentationProvider } from "../../../../../src/components/themes/BoxPresentationProvider.js";
import { ShowFrontContext } from "../../../../../src/components/themes/ThemedFileCard/CardThemeSurface.js";
import { ThemedFileCardProperties } from "../../../../../src/components/themes/ThemedFileCard/view/PropertiesFace.js";

globalThis.React = React;

const noop = () => {};
const noView = () => null;
const cardView: FileRenderer = { name: "Card", Component: noView, priority: 10 };
const renderers: FileRenderer[] = [cardView, { name: "Source", Component: noView, priority: 0 }];

/**
 * Render the Properties face for `data` at `/test1` inside a router, a tRPC
 * client that never answers, and the box presentation provider. A plain
 * button stands in for the actions menu, which needs the app workspace. `canEdit`
 * seeds the presentation answer that lets the viewer change appearance.
 */
async function render(data: FileData, { canEdit }: { canEdit: boolean }): Promise<string> {
  const theme = resolveCardTheme({
    path: data.path, type: data.type ?? "", cardChoice: data.frontmatter?.theme,
    typeDefault: undefined, presentation: { status: "absent" },
  });
  const element = React.createElement(BoxPresentationProvider, {
    boxSlug: "test1",
    children: React.createElement(ShowFrontContext.Provider, { value: noop }, React.createElement(ThemedFileCardProperties, {
      data, theme, boxSlug: "test1", renderers, active: cardView,
      hasExplicitView: false, onSelect: noop, onNavigate: noop,
      actions: data.path.endsWith(".card") ? React.createElement("button", { type: "button" }, "Card actions") : null,
    })),
  });
  const root = createRootRoute({ staticData: { title: null } });
  const box = createRoute({ getParentRoute: () => root, path: "$boxSlug", staticData: { title: null }, component: () => element });
  const router = createRouter({ routeTree: root.addChildren([box]), history: createMemoryHistory({ initialEntries: ["/test1"] }) });
  await router.load();
  const queryClient = new QueryClient();
  queryClient.setQueryData(getQueryKey(trpc.presentation.get, { boxKey: "test1", contextDir: undefined }, "query"),
    { canEditCardThemes: canEdit, typeDefaults: {}, presentation: { status: "absent" }, chrome: { choice: { name: "plain", stock: "neutral" } } });
  const client = createTRPCClient<AppRouter>({ links: [() => () => observable(() => () => {})] });
  return renderToString(React.createElement(trpc.Provider, {
    client, queryClient,
    children: React.createElement(QueryClientProvider, { client: queryClient, children: React.createElement(RouterProvider, { router }) }),
  }));
}

function textOf(html: string): string {
  return html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
}

/** The section headings in document order. */
function headings(html: string): string[] {
  return [...html.matchAll(/<h([23])[^>]*>(.*?)<\/h\1>/gs)].map(([, level, text]) => `h${level} ${textOf(text ?? "")}`);
}

/** The Appearance section's markup. */
function appearance(html: string): string {
  return /<section[^>]*data-card-section="appearance"[^>]*>.*?<\/section>(?=<section[^>]*data-card-section="view")/s.exec(html)?.[0] ?? "";
}

const doc = await render({
  path: "_content/projects/Porch.doc.card",
  type: "doc",
  schema: { hasBodyField: true, defaultProminence: "ordinary" },
  frontmatter: { title: "Porch", contains: "Porch repair quotes", "share-id": "porch-quotes", theme: { name: "paper", stock: "cream" } },
  body: "Three quotes so far.\n",
}, { canEdit: true });

// ## Order
//
// A doc with `contains` and a type field shows every section; the headings
// come in the order above:
void test("A doc with contains and a type field shows every section; the headings come i...", async (t) => {
  t.check(headings(doc), [
    "h2 Properties",
    "h3 Found by",
    "h3 Fields",
    "h3 Attachments",
    "h3 Changed",
    "h3 Mentioned by",
    "h3 Appearance",
    "h3 View",
  ]);
});

// The view chooser comes last but for the actions menu. It keeps its "Use
// preferred view" button and, under it, a button that copies the card's whole
// original text (the boxholder asked for it beside "Original text", 2026-10-13):
void test("The view chooser comes last but for the actions menu.", async (t) => {
  t.check(textOf(doc.slice(doc.lastIndexOf("<section"))), "View Doc Original text Use preferred view Copy original text Print Card actions");
});

// ## Appearance
//
// One row names the theme, its stock, and what chose it. The swatch grid sits
// under a "Change" disclosure that is closed when Properties opens:
void test("One row names the theme, its stock, and what chose it.", async (t) => {
  const section = appearance(doc);
  t.check([textOf(section.replace(/<details.*<\/details>/s, "")), /<details[^>]*><summary[^>]*>[^<]*<\/summary>/.exec(section)?.[0].replace(/ class="[^"]*"/g, "")], [
    "Appearance Paper cream · Set on this card",
    "<details><summary>Change</summary>",
  ]);

  // Inside it, the card themes that go with the system theme come first, its
  // default leading; the rest wait behind "All card themes":

  t.check(/<details.*<\/details>/s.exec(section)?.[0].match(/aria-label="([^"]*)"/g)?.slice(0, 4), [
    "aria-label=\"Choose card appearance\"",
    "aria-label=\"Goes with Flat\"",
    "aria-label=\"Flat — neutral (Flat default)\"",
    "aria-label=\"Paper — cream\"",
  ]);

  t.check(textOf(/<details class="mt-3">.*?<\/summary>/s.exec(section)?.[0] ?? ""), "All card themes");
});

// An image card also offers the image itself; a doc does not:
void test("An image card also offers the image itself; a doc does not:", async (t) => {
  const photo = await render({
    path: "_content/Porch.image.card", type: "image", schema: null,
    frontmatter: { title: "Porch", filename: { ref: "attach/porch.jpg" } },
  }, { canEdit: false });
  t.check([textOf(doc).includes("Copy image"), textOf(photo.slice(photo.lastIndexOf("<section")))], [
    false,
    "View Image Original text Use preferred view Copy original text Copy image Print Card actions",
  ]);

  // A box-authored theme has no catalog swatch; the card's own choice is still
  // drawn, first, under "This card":

  const custom = appearance(await render({
    path: "_content/Studio.doc.card", type: "doc", schema: null,
    frontmatter: { title: "Studio", theme: { name: "studio-blue", stock: "ink" } },
  }, { canEdit: true }));
  t.check(/<div role="group" aria-label="This card">.*?<\/button>/s.exec(custom)?.[0].match(/aria-label="([^"]*)"/g), [
    "aria-label=\"This card\"",
    "aria-label=\"studio-blue — ink\"",
  ]);
});

// A viewer who is not signed in sees the row without the disclosure, and a
// note saying why, so the missing control is never silent:
void test("A viewer who is not signed in sees the row without the disclosure, and a note...", async (t) => {
  const readOnly = appearance(await render({ path: "_content/Plan.doc.card", type: "doc", schema: null, frontmatter: {} }, { canEdit: false }));
  t.check([textOf(readOnly), readOnly.includes("<details")], [
    "Appearance Flat neutral · Default appearance Sign in to change this setting.",
    false,
  ]);
});

// A landmark's system theme sits in the same disclosure, below the swatch grid:
void test("A landmark's system theme sits in the same disclosure, below the swatch grid:", async (t) => {
  const landmark = appearance(await render({ path: "_content/Home.landmark.card", type: "landmark", schema: null, frontmatter: {} }, { canEdit: true }));
  t.check(/<details.*<\/details>/s.exec(landmark)?.[0].match(/aria-label="(Choose card appearance|System theme)"/g), [
    "aria-label=\"Choose card appearance\"",
    "aria-label=\"System theme\"",
  ]);
});

// ## A file that is not a card
//
// A plain Markdown file keeps its two rows, then mentions, appearance, and
// views, with no actions menu. It has no frontmatter to hold a theme, so its
// Appearance row says where a theme is set instead of offering Change:
void test("A plain Markdown file keeps its two rows, then mentions, appearance, and view...", async (t) => {
  const note = await render({ path: "notes/todo.md", frontmatter: {} }, { canEdit: true });
  t.check([headings(note), appearance(note).includes("<details"), note.includes("Card actions"), textOf(appearance(note))], [
    [
      "h2 Properties",
      "h3 Mentioned by",
      "h3 Appearance",
      "h3 View",
    ],
    false,
    false,
    "Appearance Flat neutral · Default appearance Markdown files take the box's appearance; set a theme on a card.",
  ]);
});
