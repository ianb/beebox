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
- **Hand-curated and ordered.** No auto-discovery. An `expand` entry provides templated fan-out for "list everything matching X" cases, but it's still an explicit editorial choice to include it.

### Distinct from `briefing`

`briefing.briefing.card` already exists for per-directory context aimed at agents. Landmarks are aimed at humans navigating the UI. They occupy adjacent but distinct roles:

| | Audience | Purpose |
|---|---|---|
| `briefing` | agents | context every agent needs to know about this spot |
| `landmark` | humans | "here's a bookmark to this spot, with a few pinned items" |

Both can coexist in the same directory.

## Card schema

A landmark is pure YAML frontmatter (no body) with one or more **roles**. The `navigation` role carries the bookmark fields; each `destinations` entry carries category rules and a handler procedure (its `for` list names the kinds it accepts, e.g. `triage`). A landmark can carry one or both; everything below describes the navigation role. See `docs/triage.md` for the destination role.

```yaml
---
navigation:
  label: Recipes
  symbol: 🍳
  links:
    - { ref: /_content/recipes/Bread.recipe.card, label: the bread }
    - { ref: /_content/recipes/techniques/Knife_Skills.doc.card }
  expand:
    - query: "*.recipe.card"
      order: modified-desc
      template-ref: "${path}"
      template-label: "${title}"
---
```

### Fields

All of these live under `navigation`.

**`label`** (one) — short bookmark name. Displayed prominently on the tile. Not a sentence; treat it like a tab name.

**`symbol`** (one) — the iconic mark. Two forms:

```yaml
symbol: 🍳                          # emoji or short text
symbol: { src: /_content/recipes/images/portrait.webp }   # image
```

For character-driven scenarios where the face is the bookmark, the image form makes the Landmarks page look like a real launcher rather than an emoji grid. Image `src` is a box path — write it with a leading `/`, from the box root (a path relative to the landmark's directory still resolves). It is validated: a `src` pointing at nothing is a broken-ref warning at `bbx validate`. The symbol carries most of the "iconic and unique expression" weight — pick well.

**`links`** (zero or more `{ ref, label? }`) — pinned references to other cards. `ref` is a box path to the target — leading `/`, from the box root (a path relative to the landmark's directory still resolves). It's validated like any other ref — it must point at a real file. Optional `label` is a per-landmark contextual label — call this card "the bread" here even if its real title is "Bread Basics." When omitted, the renderer falls back to the target's own title.

**`expand`** (zero or more) — templated fan-out. Runs a query, applies a template per match, generates links. See below.

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

Both surfaces — the Landmarks page grid and the chat-header landmark menu — render a group as a collapsed-by-default disclosure; on the header menu the children open in the companion sidebar just like flat links. Group children resolve server-side, capped at 50 (the collapsed `count` stays exact); a larger group renders its first 50 with a "+N more" note.

### Dedup

A card appearing both in a hand-listed `links` entry and in an unnamed `expand` result shows once: hand-listed links come first and win. This lets a landmark hoist a few items to the top with custom labels and let the rest fill in via expand below, without doubling. Named `group` expands are independent — they dedup within themselves only, not against the flat list or each other.

## Rendering

Landmarks have three rendering surfaces: the Landmarks page (the full
picture), and the app bar's two menus (the compact, always-reachable forms).
A fourth surface is the browser tab, below.

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

There is **no landmark full form** and no click-through to one: a tile links
straight to its target card. The caps above are inline disclosures for
exactly that reason — the section already *is* the landmark's full picture.
(A tile/full-form renderer pair was designed early on and never built; the
design is dropped, not deferred.)

Ordering comes from `chat.byLandmark` (latest session activity first, then
chat-less landmarks with the box root ahead of alphabetical), and the page
does not re-sort — so the page and the app bar's switch menu agree.

Two things render outside the per-landmark sections:

- **Other chats** — a trailing bucket for sessions bound to a directory with
  no landmark card (the box root without a root landmark, or a
  deleted-landmark directory). These used to be silently dropped.
- **Parse warnings** — a row naming any `**/*.landmark.card` whose
  frontmatter failed to parse (`problems`, carried by both `landmarks.list`
  and `chat.byLandmark`). A hand-edit that breaks a landmark must not make
  an activity quietly disappear.

`view: landmarks` cards render this same component, sessions included.

### App bar — switch menu and here menu

The unified app bar (`docs/implemented-plans/top-nav-ia.md`) is the compact surface:

- **Switch menu** (the place pill's left half) lists every landmark as a row
  — symbol, label, and its fresh-chat count — plus `All landmarks →` to the
  page above. Tapping a row resumes the landmark's most recent chat or
  starts one in its directory. The menu lists landmarks only; the "Other
  chats" bucket is reachable through the page. Parse problems surface here
  too. Data is fetched lazily on first open.
- **Here menu** (the place pill's right half) is the current directory's
  landmark: Open `<dir>/`, its pinned links at root level (never in a
  sub-panel), grouped expands as disclosures, and — on chat pages — Recent
  files. Links open in the companion pane on chat, and navigate normally
  elsewhere.

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

## Implementation outline

| Component | Location |
|---|---|
| Schema | `src/schemas/landmark.ts` |
| Schema registration | `src/schemas/registry.ts` |
| Expand evaluator | `src/core/landmark/` (resolves queries, applies templates, dedups, orders) |
| Merged activity surface | `src/frontend/src/components/landmarks/` (`LandmarksList`, `LandmarkSection`, `LandmarkSessions`) |
| Landmarks page | `src/frontend/src/pages/landmarks/LandmarksPage.tsx` |
| Chat buckets per landmark | `chat.byLandmark` (`src/webapp/trpc/routers/chat.ts`) |
| App-bar switch / here menus | `src/frontend/src/components/PlacePill.tsx` + the bar's chrome slots |
| API endpoint | tRPC procedure under `src/webapp/trpc/routers/` (lists landmark cards + resolves expands server-side) |
| Doctest coverage | `test/core/landmark/landmark-schema.doctest.md` (schema validation, expand semantics, dedup, order) |

The expand evaluator runs server-side at fetch time so the wire response is a fully-resolved list of links (no client-side glob or field lookup).

## Open questions

- **Order options beyond the v1 three.** By-attribute (`order="attr:priority"`) and by-XPath-value (`order="xpath:/yield/@amount"`) are obvious extensions if needed.
- **`<symbol>` extensions.** Image variant and color/mood styling are deferred until there's a real case for them. The element shape leaves room.
- **Live fields.** `<status>` or similar live-data slots are explicitly out of scope. The schema can absorb them later as new optional children without breaking existing cards.
