# Card Properties: section order and the Appearance row

`ThemedFileCardProperties` is the back of a card. `CardThemeSurface` mounts it
only while the back is shown, so its local state, including the open state of
the Appearance disclosure, starts fresh on each open.

It reads top to bottom: where the card is filed and its type, how it is found,
its type fields, what it carries, when it last changed, who mentions it, its
appearance, its alternate views, then the actions menu.

```ts setup
import * as React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { createTRPCClient } from "@trpc/client";
import { getQueryKey } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import { trpc } from "../../../../src/lib/trpc/client.js";
import { resolveCardTheme } from "@shared/card-theme/core";
import { BoxPresentationProvider } from "../../../../src/components/themes/BoxPresentationProvider.js";
import { ShowFrontContext } from "../../../../src/components/themes/ThemedFileCard/CardThemeSurface.js";
import { ThemedFileCardProperties } from "../../../../src/components/themes/ThemedFileCard/PropertiesFace.js";

globalThis.React = React;

const noop = () => undefined;
const renderers = [{ name: "Card" }, { name: "Source" }];

/**
 * Render the Properties face for `data` at `/test1` inside a router, a tRPC
 * client that never answers, and the box presentation provider. A plain
 * button stands in for the actions menu, which needs the app workspace. `canEdit`
 * seeds the presentation answer that lets the viewer change appearance.
 */
async function render(data, { canEdit }) {
  const theme = resolveCardTheme({
    path: data.path, type: data.type ?? "", cardChoice: data.frontmatter?.theme,
    typeDefault: undefined, presentation: { status: "absent" },
  });
  const element = React.createElement(BoxPresentationProvider, { boxSlug: "test1" },
    React.createElement(ShowFrontContext.Provider, { value: noop }, React.createElement(ThemedFileCardProperties, {
      data, theme, boxSlug: "test1", renderers, active: renderers[0],
      hasExplicitView: false, onSelect: noop, onNavigate: noop,
      actions: data.path.endsWith(".card") ? React.createElement("button", { type: "button" }, "Card actions") : null,
    })));
  const root = createRootRoute({ staticData: { title: null } });
  const box = createRoute({ getParentRoute: () => root, path: "$boxSlug", staticData: { title: null }, component: () => element });
  const router = createRouter({ routeTree: root.addChildren([box]), history: createMemoryHistory({ initialEntries: ["/test1"] }) });
  await router.load();
  const queryClient = new QueryClient();
  queryClient.setQueryData(getQueryKey(trpc.presentation.get, { boxKey: "test1", contextDir: undefined }, "query"),
    { canEditCardThemes: canEdit, typeDefaults: {}, presentation: { status: "absent" }, chrome: { choice: { name: "plain", stock: "neutral" } } });
  const client = createTRPCClient({ links: [() => () => observable(() => () => {})] });
  return renderToString(React.createElement(trpc.Provider, { client, queryClient },
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(RouterProvider, { router }))));
}

function textOf(html) {
  return html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
}

/** The section headings in document order. */
function headings(html) {
  return [...html.matchAll(/<h([23])[^>]*>(.*?)<\/h\1>/gs)].map(([, level, text]) => `h${level} ${textOf(text)}`);
}

/** The Appearance section's markup. */
function appearance(html) {
  return /<section[^>]*data-card-section="appearance"[^>]*>.*?<\/section>(?=<section[^>]*data-card-section="view")/s.exec(html)?.[0] ?? "";
}

const memo = await render({
  path: "_content/projects/Porch.memo.card",
  type: "memo",
  schema: { hasBodyField: true, defaultProminence: "ordinary" },
  frontmatter: { title: "Porch", contains: "Porch repair quotes", status: "new", theme: { name: "paper", stock: "cream" } },
}, { canEdit: true });
```

## Order

A memo with `contains` and a type field shows every section; the headings
come in the order above:

```ts
headings(memo)
=> [
  "h2 Properties",
  "h3 Found by",
  "h3 Fields",
  "h3 Attachments",
  "h3 Changed",
  "h3 Mentioned by",
  "h3 Appearance",
  "h3 View",
]
```

The view chooser comes last but for the actions menu, and keeps its "Use
preferred view" button:

```ts
textOf(memo.slice(memo.lastIndexOf("<section")))
=> View Memo Original text Use preferred view Card actions
```

## Appearance

One row names the theme, its stock, and what chose it. The swatch grid sits
under a "Change" disclosure that is closed when Properties opens:

```ts
const section = appearance(memo);
[textOf(section.replace(/<details.*<\/details>/s, "")), /<details[^>]*><summary[^>]*>[^<]*<\/summary>/.exec(section)?.[0].replace(/ class="[^"]*"/g, "")]
=> ["Appearance Paper cream · Set on this card", "<details><summary>Change</summary>"]
```

Inside it, the card themes that go with the system theme come first, its
default leading; the rest wait behind "All card themes":

```ts continue
/<details.*<\/details>/s.exec(section)?.[0].match(/aria-label="([^"]*)"/g)?.slice(0, 4)
=> ['aria-label="Choose card appearance"', 'aria-label="Goes with Flat"', 'aria-label="Flat — neutral (default)"', 'aria-label="Paper — cream"']

textOf(/<details class="mt-3">.*?<\/summary>/s.exec(section)?.[0] ?? "")
=> All card themes
```

A viewer who is not signed in sees the row without the disclosure, and a
note saying why, so the missing control is never silent:

```ts
const readOnly = appearance(await render({ path: "_content/Plan.doc.card", type: "doc", schema: null, frontmatter: {} }, { canEdit: false }));
[textOf(readOnly), readOnly.includes("<details")]
=> ["Appearance Flat neutral · Default appearance Sign in to change this setting.", false]
```

A landmark's system theme sits in the same disclosure, below the swatch grid:

```ts
const landmark = appearance(await render({ path: "_content/Home.landmark.card", type: "landmark", schema: null, frontmatter: {} }, { canEdit: true }));
/<details.*<\/details>/s.exec(landmark)?.[0].match(/aria-label="(Choose card appearance|System theme)"/g)
=> ['aria-label="Choose card appearance"', 'aria-label="System theme"']
```

## A file that is not a card

A plain Markdown file keeps its two rows, then mentions, appearance, and
views, with no actions menu. It has no frontmatter to hold a theme, so its
Appearance row says where a theme is set instead of offering Change:

```ts
const note = await render({ path: "notes/todo.md", frontmatter: {} }, { canEdit: true });
[headings(note), appearance(note).includes("<details"), note.includes("Card actions"), textOf(appearance(note))]
=> [["h2 Properties", "h3 Mentioned by", "h3 Appearance", "h3 View"], false, false, "Appearance Flat neutral · Default appearance Markdown files take the box's appearance; set a theme on a card."]
```
