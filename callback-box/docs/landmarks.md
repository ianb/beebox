# Landmarks

A navigation surface for the box: a hand-curated, short list of widgets pointing at the most-used spots. Each landmark is a card living in the directory it represents.

## The problem

`store/` and `box/` accumulate directories at different levels of importance. Some are well-trod (recipes, todos, calendar); others are housekeeping (trash, usage). The Browse page shows everything with equal weight — a flat file tree, no editorial layer. There's no way to say "these few directories are the main pathways into the system; the rest are just files." Landmarks are that editorial layer.

## What a Landmark is

A landmark is a single card inside a directory that says "this directory is a notable spot." It's a *bookmark*, not a museum plaque. Most appearances are tiles in a list, and the iconic form (symbol + label) is the entire content most of the time — landmarks earn their compactness by being seen many times.

Key properties:

- **Singular per directory.** One `*.landmark.card` per opted-in directory. Directories without one are invisible to the navigation surface — that's the point.
- **Thing-first, container-secondary.** The card itself is the widget. It can point at nearby cards, but it doesn't *contain* them — it references them.
- **Evergreen.** Content describes what the spot is and what's notable, long-term. Not "this week's top three." Permanence is implied by the metaphor.
- **Hand-curated and ordered.** No auto-discovery. A `<expand>` element provides templated fan-out for "list everything matching X" cases, but it's still an explicit editorial choice to include it.

### Distinct from `briefing`

`briefing.briefing.card` already exists for per-directory context aimed at agents. Landmarks are aimed at humans navigating the UI. They occupy adjacent but distinct roles:

| | Audience | Purpose |
|---|---|---|
| `briefing` | agents | context every agent needs to know about this spot |
| `landmark` | humans | "here's a bookmark to this spot, with a few pinned items" |

Both can coexist in the same directory.

## Card schema

A landmark is a root `<landmark>` with one or more **role** child elements. The navigation role (`<navigation>`) carries the bookmark fields; the triage-destination role (`<triage-destination>`) carries category rules and a handler procedure. A landmark can carry one or both; everything below describes the navigation role. See `docs/triage-design.md` for the triage role.

```xml
<landmark>
<navigation>
<label>Recipes</label>
<symbol>🍳</symbol>
<link ref="Bread.recipe.card">the bread</link>
<link ref="techniques/Knife_Skills.doc.card"/>
<expand query="*.recipe.card" order="modified-desc">
  <link template-ref="${path}">${title}</link>
</expand>
</navigation>
</landmark>
```

### Elements

All of these are children of `<navigation>`.

**`<label>`** (required, one) — short bookmark name. Displayed prominently on the tile. Not a sentence; treat it like a tab name.

**`<symbol>`** (required, one) — the iconic mark. Two forms:

```xml
<symbol>🍳</symbol>                            <!-- emoji or short text -->
<symbol src="images/portrait.webp"/>            <!-- image -->
```

For character-driven scenarios where the face is the bookmark, the image form makes the Landmarks page look like a real launcher rather than an emoji grid. Image `src` is a path relative to the landmark's directory; cross-directory paths are allowed. The symbol carries most of the "iconic and unique expression" weight — pick well.

**`<link ref="..." [text]>`** (zero or more) — a pinned reference to another card. `ref` is a literal path to the target (relative to the landmark's directory; may cross directories). It's validated like any other ref — it must point at a real file. Optional inner text is a per-landmark contextual label — call this card "the bread" here even if its real title is "Bread Basics." When inner text is omitted, the renderer falls back to the target's own title.

**`<expand query="..." [order=...]>[template]</expand>`** (zero or more) — templated fan-out. Runs the query, applies the template per match, generates `<link>` elements. See below.

### Why no `<description>` / `<purpose>` / `<intent>`

Earlier sketches included prose fields. Removed: a bookmark seen hundreds of times shouldn't carry a paragraph explaining itself. If a landmark genuinely needs a written rationale, write a doc card and `<link>` to it as the first reference. That keeps the schema honest about its job.

## The `<expand>` element

A landmark like Recipes naturally wants to surface "all recipe cards in this directory" without listing them by hand. `<expand>` is the editorial way to opt into that.

### Query

The `query` attribute is a glob pattern, matching `cb ls` conventions (`*.recipe.card`, `**/*.todo-list.card`, etc.). Resolved relative to the landmark's directory.

### Template

The element's children are a template, applied to each matched card. The default template (when children are omitted) is the equivalent of:

```xml
<link template-ref="${path}"/>
```

**Templates use `template-ref="..."`, not `ref="..."`.** The two attributes are distinct types: `ref` is a literal path that the cardworks ref-checker resolves at load time; `template-ref` carries `${...}` placeholders that get substituted per match at render time. Putting `${path}` in `ref` would (rightly) be flagged as a broken reference.

`${...}` placeholders interpolate at expand time:

- **`${path}`** — special-cased; resolves to the file path of the matched card, relative to the landmark's directory.
- **`${expr}`** for any other `expr` — evaluated as XPath against the matched card's root, via cardworks' `evaluateXPathString`. So `${title}` grabs the `<title>` element's text; `${/some/nested/value}` works for deeper paths.

Inner text on a template `<link>` is also placeholder-substituted (`<link template-ref="${path}">${title}</link>`), so you can derive the per-match label from the matched card's content.

(Note: cardworks calls this XPath, not XQuery, but the user-facing shape is the same as `cb ls`.)

The `${}` syntax differs from `cb ls`'s `{...}` deliberately — it avoids interpolating literal braces that appear in card body text.

### Order

Optional `order=""` attribute on `<expand>`:

- `"alphabetical"` — by file path. Default; matches `cb ls`.
- `"modified-desc"` — most-recently-edited first.
- `"modified-asc"` — oldest first.

The enum can grow (by-attribute, by-XPath-value) without breaking existing cards.

### Dedup

A card appearing both in a hand-listed `<link>` and in an `<expand>` result shows once: first occurrence in source order wins. This lets a landmark hoist a few items to the top with custom labels and let the rest fill in via expand below, without doubling.

## Rendering

### Tile vs. full forms

Each renderable card type defines two display forms:

- **Tile** — a bounded form fitting in a list cell. Used in lists.
- **Full** — natural-size standalone form. Used when a card is shown by itself.

There's no per-`<link>` `display="..."` attribute. The rule is contextual: anything rendered inside a list-shaped surface uses the tile form; anything rendered standalone uses the full form. If a real case demands an override later, the attribute can be added.

Each card type ships its own tile renderer over time. Until a card type opts in, the fallback tile is title + first-line snippet + (if available) icon.

### The Landmark tile

A landmark's own tile is symbol + label, plus a count of `<link>`/`<expand>` references. Click the tile and you get the full form: same symbol/label header plus the resolved list of references rendered as tiles.

### Landmarks page

A new top-level page at `/<box>/landmarks`. Lists every `**/*.landmark.card` in the box as a flat grid of tiles. Click-through opens the landmark's full form; from there, click any referenced card to view it.

Flat list to start. Tree view (grouped by directory) is a possible later refinement; the schema doesn't preclude it.

### Browse integration (deferred)

Eventually Browse can surface "the landmark for this directory" as a header crumb when you're inside a directory that has one (or the nearest landmark above when you're not). Out of scope for v1 — Landmarks page first, Browse hook-up later.

## Implementation outline

| Component | Location |
|---|---|
| Schema | `src/schemas/landmark.tsx` |
| Schema registration | `src/schemas/registry.ts` |
| Expand evaluator | `src/core/landmark/` (resolves queries, applies templates, dedups, orders) |
| Tile-renderer registry | `src/frontend/src/renderers/tile.ts` (mirrors existing renderer registry) |
| Landmark renderer (tile + full) | `src/frontend/src/renderers/landmark.tsx` |
| Landmarks page | `src/frontend/src/pages/LandmarksPage.tsx` |
| Route + nav entry | `src/frontend/src/components/AppNav.tsx` + router |
| API endpoint | tRPC procedure under `src/webapp/trpc/routers/` (lists landmark cards + resolves expands server-side) |
| Doctest coverage | `test/landmark.doctest.md` (schema validation, expand semantics, dedup, order) |

The expand evaluator runs server-side at fetch time so the wire response is a fully-resolved list of links (no client-side glob/XPath).

## Open questions

- **Tile renderer rollout order.** Which card types get bespoke tile renderers first? Recipe and todo-list are obvious early candidates. Most others can live with the fallback indefinitely.
- **Order options beyond the v1 three.** By-attribute (`order="attr:priority"`) and by-XPath-value (`order="xpath:/yield/@amount"`) are obvious extensions if needed.
- **`<symbol>` extensions.** Image variant and color/mood styling are deferred until there's a real case for them. The element shape leaves room.
- **Live fields.** `<status>` or similar live-data slots are explicitly out of scope. The schema can absorb them later as new optional children without breaking existing cards.
