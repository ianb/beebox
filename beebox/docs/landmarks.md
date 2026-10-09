# Landmarks

A navigation surface for the box: a hand-curated, short list of widgets pointing at the most-used spots. Each landmark is a card living in the directory it represents.

## The problem

`_content/` and `_bookkeeping/` accumulate directories at different levels of importance. Some are well-trod (recipes, todos, calendar); others are housekeeping (trash, usage). The Browse page shows everything with equal weight — a flat file tree, no editorial layer. There's no way to say "these few directories are the main pathways into the system; the rest are just files." Landmarks are that editorial layer.

## What a Landmark is

A landmark is a single card inside a directory that says "this directory is a notable spot." It's a *bookmark*, not a museum plaque. Most appearances are tiles in a list, and the iconic form (symbol + label) is the entire content most of the time — landmarks earn their compactness by being seen many times.

Key properties:

- **Singular per directory.** One `*.landmark.card` per opted-in directory. Directories without one are invisible to the navigation surface — that's the point.
- **Thing-first, container-secondary.** The card itself is the widget. It can point at nearby cards, but it doesn't *contain* them — it references them.
- **Evergreen.** Content describes what the spot is and what's notable, long-term. Not "this week's top three." Permanence is implied by the metaphor.
- **Derived first, curated for the rest.** The list is mostly the cards under the directory that carry `prominence: entry-point` or `prominence: primary` (see "Derived links" below); `links:` is the curated exception for what a card cannot say about itself, and an `expand` entry is templated fan-out for "list everything matching X". Ordering is by tier, then by name; a fixed order is what `links:` is for.
- **A place you can visit.** The landmark card is `background` by type: Browse folds it and draws the directory's identity from it, and derivation never lists it. When a person opens it, from a chat link or the Browse folder header, it renders as the **place page** (see "Rendering"). The place's entry point, if it has one, is a card inside the directory, and arrival opens it in place of the page (see "Arrival"). See `docs/implemented-plans/card-prominence.md`.

### Distinct from `briefing`

`briefing.briefing.card` already exists for per-directory context aimed at agents. Landmarks are aimed at humans navigating the UI. They occupy adjacent but distinct roles:

| | Audience | Purpose |
|---|---|---|
| `briefing` | agents | context every agent needs to know about this spot |
| `landmark` | humans | "here's a bookmark to this spot, with a few pinned items" |

Both can coexist in the same directory. Chat openers belong to the landmark (`navigation.openers`), not to the briefing; the `briefing-openers-2026-10` migration moved them.

## Card schema

A landmark is pure YAML frontmatter (no body) with one or more **roles**. The `navigation` role carries the bookmark fields; each `destinations` entry carries category rules and a handler procedure (its `for` list names the kinds it accepts, e.g. `triage`). A landmark can carry one or both; everything below describes the navigation role. See `docs/triage.md` for the destination role.

```yaml
---
symbol:
  glyph: 🍳
navigation:
  label: Recipes
  links:
    - { ref: /_content/recipes/Bread.recipe.card, label: the bread }
    - { ref: /_content/recipes/techniques/Knife_Skills.doc.card }
  expand:
    - query: "*.recipe.card"
      order: modified-desc
      template-ref: "${path}"
      template-label: "${title}"
  openers:
    - What can I cook tonight?
---
```

### Fields

All of these live under `navigation`, except `symbol`, which is a top-level field every card may carry.

**`label`** (one) — short bookmark name. Displayed prominently on the tile. Not a sentence; treat it like a tab name.

**`symbol`** (one) — the iconic mark. Two forms:

```yaml
symbol: { glyph: 🍳 }               # emoji or short text
symbol: { src: /_content/recipes/images/portrait.webp }   # image
```

For character-driven scenarios where the face is the bookmark, the image form makes the Landmarks page look like a real launcher rather than an emoji grid. Image `src` is a box path — write it with a leading `/`, from the box root (a path relative to the landmark's directory still resolves). It is validated: a `src` pointing at nothing is a broken-ref warning at `bbx validate`. The symbol carries most of the "iconic and unique expression" weight — pick well.

**`links`** (zero or more `{ ref, label? }`) — pinned references to other cards. `ref` is a box path to the target — leading `/`, from the box root (a path relative to the landmark's directory still resolves). It's validated like any other ref — it must point at a real file. Optional `label` is a per-landmark contextual label — call this card "the bread" here even if its real title is "Bread Basics." When omitted, the renderer falls back to the target's own title.

**`expand`** (zero or more) — templated fan-out. Runs a query, applies a template per match, generates links. See below.

**`openers`** (zero or more strings) — one-line first moves, phrased from the person's side. They show as buttons on an unstarted chat in this place and in the place page's "Start something" group; a click sends the line as the person's message. Each is one non-blank line of at most 120 characters; an invalid opener makes the landmark fail to parse, which shows as a parse warning. A place with no `openers` shows none and does not inherit the root's. The root landmark of a new box carries two onboarding openers (`STOCK_ROOT_OPENERS` in `src/schemas/landmark.ts`); the retrospective procedure removes them once the box is in regular use.

### Why no `description` / `purpose` / `intent`

Earlier sketches included prose fields. Removed: a bookmark seen hundreds of times shouldn't carry a paragraph explaining itself. If a landmark genuinely needs a written rationale, write a doc card and add it to `links` as the first reference. That keeps the schema honest about its job.

## The `expand` entry

A landmark like Recipes naturally wants to surface "all recipe cards in this directory" without listing them by hand. `expand` is the editorial way to opt into that.

### Query

`query` is a glob pattern, matching `bbx ls` conventions (`*.recipe.card`, `**/*.doc.card`, etc.). Resolved relative to the landmark's directory.

### Template

`template-ref` / `template-label` are placeholder strings applied to each matched card. When `template-ref` is omitted, each match links by its **box path** (the canonical leading-`/` form, resolved as a literal path).

`${...}` placeholders interpolate at expand time:

- **`${path}`** — special-cased; resolves to the file path of the matched card, relative to the landmark's directory.
- **`${field}`** for any other name — reads that field from the matched card's **frontmatter**. So `${title}` grabs the card's `title:` field; dotted paths like `${exif.camera}` walk nested mappings. Missing or non-scalar values render as the empty string.

`template-label` derives the per-match label the same way (`template-label: "${title}"`).

The `${}` syntax differs from `bbx ls`'s `{...}` deliberately — it avoids interpolating literal braces that appear in card body text.

### Order

Optional `order` on an `expand` entry:

- `alphabetical` — by file path. Default; matches `bbx ls`.
- `modified-desc` — most-recently-edited first.
- `modified-asc` — oldest first.

The enum can grow without breaking existing cards.

### Group (collapsible submenu)

An `expand` carrying a `group: <title>` keeps its matches **grouped under that title** instead of flattening them into the flat link list. Collapsed, the group shows its title and a child count (e.g. `Images · 134`); expanded, it reveals the matched links. Use it for broad "all the X" globs (e.g. `group: Images` over `**/*.image.card`) that would otherwise flood the flat grid. An `expand` without `group` flattens inline as before.

Both surfaces — the Landmarks page grid and the app bar's folder menu — render a group as a collapsed-by-default disclosure; on the folder menu the children open in the companion sidebar just like flat links. Group children resolve server-side, capped at 50 (the collapsed `count` stays exact); a larger group renders its first 50 with a "+N more" note.

### Dedup

A card appearing both in a hand-listed `links` entry and in an unnamed `expand` result shows once: hand-listed links come first and win. This lets a landmark hoist a few items to the top with custom labels and let the rest fill in via expand below, without doubling. Named `group` expands are independent — they dedup within themselves only, not against the flat list or each other.

## Derived links

A landmark's flat list is assembled in tiers (`src/core/landmark/resolve/core.ts`, `derived-links.ts`):

1. hand-listed `links:` (first, and winning dedup, with their labels); a listed card that is also a derived entry point or primary card keeps that level as the link's `prominence`, so the place page shows it in that tier;
2. derived `entry-point` cards, then derived `primary` cards, from the landmark's **pruned subtree**: its directory and every descendant directory that has no landmark of its own, never entering an owned `.attach/` scope unless that scope holds its own landmark;
3. nested landmarks, one entry each (label, symbol), except those written `prominence: background`;
4. unnamed `expand` results.

Within a derived tier the order is by box path. A card's level is its written `prominence`, else its type's default (`defaultProminence` on the schema: `background` for `category: "system"` types and for landmarks, `ordinary` otherwise). The walk is fresh on every call and parses are cached per file by identity (`prominence-index.ts`, `prominence-cache.ts`), the same shape as `card-cache.ts`; `landmarks.identity` serves the mount-path callers (place pill, tab title) with no resolution at all, and `landmarks.forDir` resolves on demand.

A landmark written `prominence: background` is a housekeeping place: off the Landmarks page and the switch menu (`cascade.ts`, `isListedLandmark`), and every card under it is background for folding and derivation, whatever the card says. `bbx validate` warns on `entry-point`/`primary` written on a landmark, on a prominent card under a background place, and on too many entry points or primary cards in one directory (`lint-prominence.ts`).

Existing boxes were migrated by `landmark-links-prominence`: every in-subtree `links:` target got `prominence: primary`; no link was removed.

## Rendering

Landmarks have four rendering surfaces: the place page (the landmark card
itself), the Landmarks page (every place at once), and the app bar's two
menus (the compact, always-reachable forms). A fifth surface is the browser
tab, below.

### The place page — the landmark card

A landmark card renders as the place page (renderer `Place`,
`src/frontend/src/renderers/landmark.tsx`, `components/PlaceView/`). It shows
what the place holds, not its configuration:

- **Start something** — the place's openers, shown only beside a chat in the
  same place that does not already show them. Beside an unstarted chat in the
  same place the group is hidden, because the chat shows the same openers.
  Beside another place's chat the group is hidden and a "Go to <label>" link
  opens that place's chat. Outside a chat the group is hidden.
- **The links in tiers** — "Start here" (entry points), "Main cards"
  (primary), "Places inside" (nested landmarks), "Pinned" (curated `links:` with no derived level),
  then each `expand` as an open group. An unnamed `expand` gets a plain label
  from its query ("Every loan card here"; `src/core/landmark/expand-label.ts`).
  A group that matches nothing shows "None yet". A curated link whose target
  is gone keeps its row, struck through.
- **An empty place** says "Nothing here yet." and links to its folder in
  Browse.

The page reads `landmarks.forDir` with `expandsAsGroups: true`; the menus
leave the flag off and keep the flat list. The landmark's fields show under
Properties.

The place page is reached from a chat link, from the Browse folder header,
and by arrival when the place has no single entry point. The here menu has no
place-page row.

### Landmarks page — the merged activity surface

`/<box>/landmarks` is one section per landmark, each carrying both halves of
the landmark's activity: its **chats** and its **links**. It absorbed the
former Chats page (`/chats` redirects here) — the two were the same
landmark-keyed page projected twice (`docs/implemented-plans/top-nav-ia.md` Track D).
Implementation: `LandmarksList` + `LandmarkSection` + `LandmarkSessions` in
`src/frontend/src/components/landmarks/`.

A section renders:

- **Header** — symbol + label, and the directory path as a link into Browse.
- **Chats** — the landmark's sessions as rows, an older-sessions disclosure
  (`olderSessions` from `chat.byLandmark`), and a "New chat" action bound to
  the landmark's directory.
- **Links** — resolved `links` + flat `expand` results as tiles, capped at
  the first 6 with an inline "Show all N" disclosure. Grouped expands
  (`group:`) stay collapsed count-chips beside them. A ref pointing at
  nothing renders as "Missing" rather than vanishing.

A tile links straight to its target card. The caps above are inline
disclosures, so the section shows all of a landmark's links in place. The
landmark card itself opens as the place page (above).

Ordering comes from `chat.byLandmark` (latest session activity first, then
chat-less landmarks with the box root ahead of alphabetical), and the page
does not re-sort — so the page and the app bar's landmark menu agree.

A **Find a landmark** field sits above the sections. It does not take focus
when the page opens. Empty, the page shows the full hierarchy. With text, it shows the
matching landmarks and their ancestors, in the same indented form
(`src/frontend/src/lib/landmark-filter.ts`).

Two things render outside the per-landmark sections:

- **Other chats** — a trailing bucket for sessions bound to a directory with
  no landmark card (the box root without a root landmark, or a
  deleted-landmark directory). These used to be silently dropped.
- **Parse warnings** — a row naming any `**/*.landmark.card` whose
  frontmatter failed to parse (`problems`, carried by both `landmarks.list`
  and `chat.byLandmark`). A hand-edit that breaks a landmark must not make
  an activity quietly disappear.

`view: landmarks` cards render this same component, sessions included.

### App bar — landmark menu and folder menu

The unified app bar is the compact surface. Each half of the place pill has
one job:

- **Landmark menu** (the place pill's left half) says where the conversation
  is and where it can move. Its first row, `Box: <name>`, opens the box
  screen (`/<box>/box`) with a full page load; the box screen holds recent
  chats, the `nav.card` shortcuts, and the other boxes (see
  [Quick chat](chat/quick-chat.md#the-box-screen)). Next is **Find a
  landmark**, which opens the page above. Then every landmark as a row —
  symbol, label, and its fresh-chat count — with a filter field past 20
  landmarks. Tapping a row resumes the landmark's most recent chat or starts
  one in its directory; on the desktop layout, arrival (below) then opens the
  place beside that chat. The menu lists landmarks only; the "Other chats"
  bucket is reachable through the page. Parse problems surface here too.
  Data is fetched lazily on first open.
- **Folder menu** (the place pill's right half) is the current directory's
  landmark: Open `<dir>/`, Search (the box's search page), on chat pages
  Recent files, then its pinned links at root level (never in a sub-panel)
  and grouped expands as disclosures. Links open in the companion pane on
  chat, and navigate normally elsewhere. The folder half renders only when
  a landmark resolves for the directory.

The box-wide pages (Dashboard, Browse, History, Storage summary) are in the
**avatar menu** at the right of the bar, below Settings and Admin
(`frontend/src/components/AppNav/BoxPageMenuItems.tsx`). The rows keep the ids
`bbx-box-menu-dashboard`, `-browse`, `-history`, and `-inventory`.

### The browser tab, and everywhere else a box is drawn

A landmark's `symbol` for the directory you are in leads the **tab title**
(`frontend/src/components/DocumentPlace.tsx`), while the **tab icon** is the
box's own mark. Splitting them that way lets a tab say both which box it
belongs to and which place inside it you are looking at; an icon that followed
the landmark instead meant two boxes' tabs could wear the same mark.

**The box root's landmark is the box's own identity.** Its `label` is the box's
display name in every `/api/boxes` listing — the box switcher, the dashboard
header, and the `<page> — <box>` tab title — and its `symbol` is the box's
mark — drawn on the tab, on the box selector, on a notification, and on the
installed app's icon. The box server stamps it into the served document so a
tab is identifiable before the app boots, and renders it as a PNG for the
surfaces that require one (`core/landmark/box-identity.ts`,
`webapp/index-html.ts`, `webapp/routes/box-identity-assets.ts`). A box had no display name before this; it answered
with its slug. Renaming a box is editing that card, which is why there is no
box-name setting anywhere.

## Arrival

On the desktop layout, going to a place opens the place beside its chat when
this browser tab has no saved card arrangement for that chat. This happens
when a person chooses a place in the landmark menu, or opens a chat in this
tab for the first time. The card that opens is the **arrival target**
(`arrival` on the `landmarks.forDir` payload): the single `entry-point` card
in the place's pruned subtree when there is exactly one, else the landmark
card, which shows the place page. The rule applies to the box root too.

On the phone layout, arrival opens no card. One card or the chat fits on the
screen, and the chat has priority.

Arrival is quiet in these cases:

- **Saved arrangement.** The chat's cards are saved per tab
  (`sessionStorage`) on every card action, including an arrangement with no
  cards. A chat with a saved arrangement opens as the person left it. A new
  tab has no saved arrangements, so arrival runs there again.
- **Reload, Back, and Forward.** The arrived card is in the history entry, so
  reload and Forward restore it and do not arrive again. Arrival adds no
  history entry.
- **The person acts first.** A pointer, focus, or key event in the chat pane
  (transcript, cards, or composer), or any card action, before the place
  query returns cancels the pending arrival.
- **No landmark, or the query fails.** Nothing opens; a failed query logs a
  warning.

Implementation: the workspace store sets the arrival candidate when
`select` finds nothing saved (`WorkspaceProvider/workspace-browser-store.ts`,
`takeArrival`, `cancelArrival`). The provider waits for the place query on
the desktop layout, then decides in its `keep-current` branch with
`arrivalOpens` (`components/chat/workspace/WorkspaceProvider/arrival.ts`), before it writes the
history entry. See `docs/plans/landmark-arrival.md`, Track D.

## Implementation outline

| Component | Location |
|---|---|
| Schema | `src/schemas/landmark.ts` |
| Schema registration | `src/schemas.ts` |
| Expand evaluator | `src/core/landmark/` (resolves queries, applies templates, dedups, orders) |
| Place page | `src/frontend/src/renderers/landmark.tsx`, `src/frontend/src/components/PlaceView/` |
| Arrival | `src/frontend/src/components/chat/workspace/WorkspaceProvider/` (`arrival.ts`, `workspace-browser-store.ts`, `provider.tsx`) |
| Merged activity surface | `src/frontend/src/components/landmarks/` (`LandmarksList`, `LandmarkSection`, `LandmarkSessions`) |
| Landmarks card | `src/frontend/src/renderers/system-cards.tsx` (the `/landmarks` route redirects to the canonical card) |
| Chat buckets per landmark | `chat.byLandmark` (`src/webapp/trpc/routers/chat/router.ts`) |
| App-bar landmark / folder menus | `src/frontend/src/components/AppNav/PlacePill.tsx` + the bar's chrome slots |
| API endpoint | tRPC procedure under `src/webapp/trpc/routers/` (lists landmark cards + resolves expands server-side) |
| Doctest coverage | `test/core/landmark/resolve.schema.doctest.md` (schema validation, expand semantics, dedup, order) |

The expand evaluator runs server-side at fetch time so the wire response is a fully-resolved list of links (no client-side glob or field lookup).

## Open questions

- **Order options beyond the v1 three.** By-attribute (`order="attr:priority"`) and by-XPath-value (`order="xpath:/yield/@amount"`) are obvious extensions if needed.
- **`<symbol>` extensions.** Image variant and color/mood styling are deferred until there's a real case for them. The element shape leaves room.
- **Live fields.** `<status>` or similar live-data slots are explicitly out of scope. The schema can absorb them later as new optional children without breaking existing cards.
