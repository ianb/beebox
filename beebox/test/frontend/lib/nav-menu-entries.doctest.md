# Nav-card entries in the switch menu

`navMenuEntries` (`lib/nav-menu-entries.ts`) decides which of a box's
`nav.card` entries the app bar's switch menu renders. The card used to drive a
whole link row; with the row retired (docs/implemented-plans/top-nav-ia.md Track C3) its
entries become a section inside the menu — but the menu already has builtin
rows for most routes, so a duplicate is dropped rather than shown twice.

```ts setup
import { navMenuEntries } from "../../../src/frontend/src/lib/nav-menu-entries.js";

const rows = (entries) => navMenuEntries({ entries, base: "/test1" })
  .map((r) => `${r.label} → ${r.to}`)
  .join("\n");
```

## `ref:` entries always render

A card the box pinned has no builtin home, so every ref renders, targeting the
same `/browse/<path>` the link row used.

```ts
rows([
  { kind: "ref", target: "store/Reading_List.memo.card", label: "Reading list" },
  { kind: "ref", target: "recipes/index.memo.card", label: "Recipes" },
])
=> Reading list → /test1/browse/store/Reading_List.memo.card
Recipes → /test1/browse/recipes/index.memo.card
```

## `href:` entries the menu already reaches are skipped

`/` and `/chat` are the pill's own landing; `/chats` and `/landmarks` are the
"All landmarks" row; `/browse`, `/history` and `/dashboard` are the Box
submenu. A card naming all seven contributes no rows at all — which is also
what makes the section (and its divider) vanish entirely.

```ts
rows([
  { kind: "href", target: "/", label: "Chat" },
  { kind: "href", target: "/chat", label: "Chat" },
  { kind: "href", target: "/chats", label: "Chats" },
  { kind: "href", target: "/landmarks", label: "Landmarks" },
  { kind: "href", target: "/browse", label: "Browse" },
  { kind: "href", target: "/history", label: "History" },
  { kind: "href", target: "/dashboard", label: "Dashboard" },
]).length
=> 0
```

## Destinations with no other menu presence render

Settings and Admin live in the profile menu but not the switch menu; Questions
and Capture have no menu row anywhere. A box that pinned them keeps them.

```ts continue
rows([
  { kind: "href", target: "/settings", label: "Settings" },
  { kind: "href", target: "/admin", label: "Admin" },
  { kind: "href", target: "/questions", label: "Questions" },
  { kind: "href", target: "/capture", label: "Capture" },
])
=> Settings → /test1/settings
Admin → /test1/admin
Questions → /test1/questions
Capture → /test1/capture
```

A mixed card renders exactly the ref plus the non-duplicating href, in card
order.

```ts continue
rows([
  { kind: "href", target: "/browse", label: "Browse" },
  { kind: "ref", target: "notes/Trip.memo.card", label: "Trip" },
  { kind: "href", target: "/questions", label: "Questions" },
])
=> Trip → /test1/browse/notes/Trip.memo.card
Questions → /test1/questions
```

## Labels fall back

The resolver fills a label from the card, the target card's title, or the
route table — but an entry that still arrives unlabelled gets the builtin
route's name, and an unknown route (or a ref) names itself.

```ts continue
rows([
  { kind: "href", target: "/questions", label: "" },
  { kind: "href", target: "/some-future-page", label: "" },
  { kind: "ref", target: "notes/Trip.memo.card", label: "" },
])
=> Questions → /test1/questions
/some-future-page → /test1/some-future-page
notes/Trip.memo.card → /test1/browse/notes/Trip.memo.card
```
