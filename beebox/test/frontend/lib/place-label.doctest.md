# Place label (app-bar pill fallback)

`placeLabel` (`lib/place-label.ts`) maps a router pathname to the place the
`PlacePill` names: a display label plus the box-relative directory the place
sits in. It's the fallback the bar uses on every page that doesn't publish a
richer context of its own.

`dir` is tri-state, exactly like the chat context chip's: `null` means "this
route has no directory", `""` means "the box root", and a string is a real
subdirectory. A non-null `dir` is what gets handed to `landmarks.forDir`.

```ts setup
import { placeLabel } from "../../../src/frontend/src/lib/place-label.js";
```

## The box root is Home; a literal `/chat` route is still Chat

`/` redirects to `/chat` (Track A) and both render the same page, but the pill
names the bare box root "Home" (docs/glossary.md) while a literal `/chat`
route keeps "Chat".

```ts
JSON.stringify(placeLabel({ pathname: "/test1", boxSlug: "test1" }))
=> {"label":"Home","dir":null}

JSON.stringify(placeLabel({ pathname: "/test1/", boxSlug: "test1" }))
=> {"label":"Home","dir":null}

JSON.stringify(placeLabel({ pathname: "/test1/chat", boxSlug: "test1" }))
=> {"label":"Chat","dir":null}
```

## Static routes each name themselves

```ts
const labelOf = (path: string) => placeLabel({ pathname: path, boxSlug: "test1" }).label;

[
  labelOf("/test1/landmarks"),
  labelOf("/test1/dashboard"),
  labelOf("/test1/history"),
  labelOf("/test1/questions"),
  labelOf("/test1/settings"),
  labelOf("/test1/admin"),
].join(" | ")
=> All landmarks | Dashboard | History | Questions | Settings | Admin
```

Sub-paths of a static route keep the section's label — `/history/<hash>` is
still History.

```ts continue
labelOf("/test1/history/a1b2c3")
=> History
```

## Browse names the path, and carries the dir

A directory path is itself the dir.

```ts
JSON.stringify(placeLabel({ pathname: "/test1/browse/_content/recipes", boxSlug: "test1" }))
=> {"label":"Browse: _content/recipes","dir":"_content/recipes"}
```

A trailing segment with a `.` reads as a file, so the dir is its parent — the
landmark lookup wants the enclosing directory, not the card.

```ts
JSON.stringify(placeLabel({ pathname: "/test1/browse/_content/recipes/Bread.card", boxSlug: "test1" }))
=> {"label":"Browse: _content/recipes/Bread.card","dir":"_content/recipes"}
```

Browsing the box root has no path portion, and its dir is the root (`""`, not
`null`) — the root can itself hold a landmark.

```ts
JSON.stringify(placeLabel({ pathname: "/test1/browse", boxSlug: "test1" }))
=> {"label":"Browse","dir":""}
```

## Card routes name the kind and resolve their enclosing dir

Both `/card/$` and `/views/$` render one card; the card's own title is the page
heading, so the pill names the kind and spends its dir on the landmark lookup.

```ts
JSON.stringify(placeLabel({ pathname: "/test1/card/_content/recipes/Bread.card", boxSlug: "test1" }))
=> {"label":"Card","dir":"_content/recipes"}

JSON.stringify(placeLabel({ pathname: "/test1/views/_content/plate.todo-view.card", boxSlug: "test1" }))
=> {"label":"Card","dir":"_content"}
```

## Anything unmapped falls back to the landing

An unknown route (the router redirects these to the box root anyway) names the
landing rather than inventing a label.

```ts
JSON.stringify(placeLabel({ pathname: "/test1/nonesuch", boxSlug: "test1" }))
=> {"label":"Chat","dir":null}
```
