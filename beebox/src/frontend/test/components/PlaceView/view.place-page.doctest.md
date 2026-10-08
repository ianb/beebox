# The place page

A landmark card renders as the place page: its openers where they can be
sent, then its links in tiers and each `expand` as a
labeled group (docs/plans/landmark-arrival.md, Track C). These examples render
`PlacePage` with a loaded `landmarks.forDir` payload, the way the
`PersonView` doctest renders a person's front.

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { PlacePage } from "../../../src/components/PlaceView/view.js";
import { PlaceChatContext } from "../../../src/components/openers/place-chat.js";
import { BoxSlugProvider } from "../../../src/lib/box-slug.js";

globalThis.React = React;

function payload(overrides = {}) {
  return {
    path: "_content/lending/Lending.landmark.card",
    dir: "_content/lending",
    label: "Lending",
    symbol: { glyph: "🤝" },
    prominence: null,
    links: [],
    groups: [],
    depth: 0,
    features: {},
    openers: ["Who has what right now?", "Log a new loan"],
    arrival: "_content/lending/Lending.landmark.card",
    ...overrides,
  };
}

/** Render the page inside a router, a query client that never answers, and (optionally) a chat. */
async function render(props, chat = null) {
  const page = React.createElement(PlacePage, { cardPath: "_content/lending/Lending.landmark.card", onNavigate: () => undefined, onGoToPlace: () => undefined, ...props });
  const withChat = React.createElement(PlaceChatContext.Provider, { value: chat }, page);
  const element = React.createElement(BoxSlugProvider, { boxSlug: "test1" }, withChat);
  const root = createRootRoute({ staticData: { title: null }, component: () => element });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  return renderToStaticMarkup(React.createElement(QueryClientProvider, { client: new QueryClient() }, React.createElement(RouterProvider, { router })));
}

/** The page's visible text, tags (and a trailing cut-off tag) collapsed to single spaces. */
function text(html) {
  return html.replace(/<[^>]*(?:>|$)/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
}

/** The visible text of one `data-place-section`, up to the next section. */
function sectionText(html, name) {
  const part = html.split('data-place-section="').find((p) => p.startsWith(`${name}"`));
  return part === undefined ? null : text(part.slice(part.indexOf(">") + 1));
}

/** The `data-place-section` names, in page order. */
function sections(html) {
  return [...html.matchAll(/data-place-section="([^"]*)"/g)].map((m) => m[1]);
}

const startedLending = { contextDir: "_content/lending", showsOwnOpeners: false, sendOpener: () => "accepted" };
```

## An empty place says so and names its folder

No links and no groups: "Nothing here yet." and the folder, which opens in
Browse. A place with no openers shows no "Start something".

```ts
const html = await render({ payload: payload({ openers: [] }) }, startedLending);
({ sections: sections(html), text: text(html) })
=> { sections: ["empty"], text: "Nothing here yet. This place is the folder lending/ . Ask in the chat to add the first card." }
```

## Tiers and groups, with an empty group saying "None yet"

A curated link whose card is gone keeps its row, struck through, so the place
does not silently shrink. Groups render open on this page.

```ts
const html = await render({ payload: payload({
  openers: [],
  links: [
    { ref: "_content/lending/List.memo.card", label: null, title: "Lending list", exists: true, source: "derived", prominence: "entry-point" },
    { ref: "_content/lending/Gone.memo.card", label: null, title: "Gone", exists: false, source: "listed" },
  ],
  groups: [{ label: "Every receipt card here", count: 0, children: [] }],
}) }, startedLending);
({
  sections: sections(html),
  struck: html.match(/<s>([^<]*)<\/s>/)?.[1],
  groupOpen: html.includes('aria-expanded="true"'),
  text: text(html),
})
=> {
  sections: ["entry-point", "pinned", "group"],
  struck: "Gone",
  groupOpen: true,
  text: "Start here Lending list _content/lending/List.memo.card Pinned Gone Missing Every receipt card here 0 None yet",
}
```

## Outside a chat, "Start something" is hidden

The same place with openers, opened with no chat beside it.

```ts
sections(await render({ payload: payload() }))
=> ["empty"]
```

## Beside a started chat in the place, the openers are offered

```ts
const html = await render({ payload: payload() }, startedLending);
({ sections: sections(html), start: sectionText(html, "start-something") })
=> { sections: ["start-something", "empty"], start: "Start something Who has what right now? Log a new loan" }
```

## Beside another place's chat, a "Go to" link replaces the openers

```ts
const html = await render({ payload: payload() }, { contextDir: "", showsOwnOpeners: false, sendOpener: () => "accepted" });
({ sections: sections(html), goTo: sectionText(html, "go-to") })
=> { sections: ["go-to", "empty"], goTo: "The open chat is in another place. Go to Lending" }
```

## Two landmarks in one folder

If the folder's landmark is another card, the page names both paths instead of
showing that card's links as this one's.

```ts
text(await render({ payload: payload({ path: "_content/lending/Aaa.landmark.card" }) }))
=> This folder has two landmark cards, _content/lending/Lending.landmark.card and _content/lending/Aaa.landmark.card. The place uses _content/lending/Aaa.landmark.card; keep one landmark card per folder.
```

## The mark and label show only in an embed

In a pane or on its own page the card header already names the place; an
embedded card has no header, so the page draws the mark and label itself.

```ts
({
  pane: text(await render({ payload: payload({ openers: [] }) })).startsWith("Nothing"),
  embed: text(await render({ payload: payload({ openers: [] }), heading: true })).slice(0, 10),
})
=> { pane: true, embed: "🤝 Lending" }
```
