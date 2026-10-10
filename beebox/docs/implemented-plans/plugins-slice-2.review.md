# Plan Engineering Review — plugins slice 2

Cross-model plan review of `plugins-slice-2.md` by codex gpt-6-sol (effort
high, 2026-10-10), adjudicated by the planning session. Prompt and raw answer
under `scratch/cross-model/` (untracked).

## What already exists

Verified by the reviewer against the plan's citations: the loader reads a
stub's `template` export (`src/schemas.ts:356`); a synthetic Markdoc `Node`
is constructible; the import boundary (`plugin-imports.ts:26`) and the
public export surface (`exports/cards.ts`).

## Ontology (verified against the code's own names)

No finding. `markdocTags`, `tags`, `components`, render name: as the code
spells them.

## Prior art (external) — verified

Markdoc per-call config; no finding.

## Stated preferences this plan trades against

Finding: the plan keeps briefing's and capture-session's tags global against
the recorded decision. Adjudication: moved to *Open design questions* with a
lean to defer; the boxholder decides.

## Could this be simpler? (verified)

Finding: the render-name introspection (`coreRenderNames()`, synthetic
transforms) adds machinery and misses the inline form. Accepted: cut; the
view doctest renders both forms through the real widget.

## Failure modes

Finding (most important): a tag with no schema loses its attributes at
render, so an inactive plugin or a box-local type without a view shows
"flour" for `{% ingredient amount="2" unit="cups" %}flour{% /ingredient %}`.
Accepted: Track 1 adds an `unknown-tag` rewrite that renders the authored
opening tag plus children, and the frontend doctest asserts amount, unit and
ref survive. The presentation (muted code of the authored tag) is a
boxholder-visible choice, reported for veto.

Finding: `emitRecipeTag` holds the GFM `task` checkbox case. Accepted: moved
to `emitMarkupTag` before the delete; emit doctest keeps a checklist case.

Finding: Track 2's first checkpoint removed the core tag rows while the core
view still rendered through them. Accepted: the first chunk moves schema,
template and README with tags left in core; the second moves tags and view
together.

## Agent-flow / user-flow edge cases

Finding: `lint-cards.ts:403` cited for ref resolution is an unknown-key
warning. Accepted: cites `body-refs.ts:320-326` and `lint-cards.ts:190`.

## Findings

Nine findings; all accepted and folded into the plan. Two are recorded as
decisions for the boxholder (fallback presentation; scoping built-in types'
tags now or later).

### `recipe.template` is not on `PluginDefinition`
Accepted: `plugin.ts` exports `template` by name; the stub re-exports it;
`beebox/cards` exports `type TemplateDefinition`.

### The recipe base imports `cards/sources-entry` across the boundary
Accepted: `beebox/cards` exports `LabeledSourcesEntrySchema`.

## NOT in scope (verified)

The reviewer raised no objection to the deferrals other than the
built-in-type tags, now an open question.

## Things I checked and found clean

Body ref collection walks the raw AST (`body-refs.ts:320`), independent of
the tag table. Todo extraction keeps only `todo`/`see-also` errors
(`todo/extract/body.ts:88-91`). Publish lowering already fails on recipe
tags. Search extraction does not use the tag table. The reviewer named 23
files opened beyond the read-list; none changed a conclusion.

## Implementation review (codex gpt-6-sol, 2026-10-10)

Round 1 on the branch diff found four items; all fixed in `85c4d4a13`:

- Scaled yield rendered `[object Object]` for a range (`2-3` at 2×). Fixed:
  the scaled value renders as a React node; the view doctest asserts
  `4–6 servings`.
- `in` matched prototype keys (`toString`) in the unknown-tag rewrite and the
  core-tag check. Fixed with `Object.hasOwn`; doctest case.
- Variable attributes serialized as Markdoc internals. Fixed: the authored
  attribute string is built once in `authoredAttributes()`; `{% garnish
  amount=$n %}` renders as written.
- The enumerating doctest never installed the stubs. Fixed: it writes each
  plugin's README stubs into a temp box and validates.

Round 2 verified three fixes hold and found the fourth partial: a stub that
fails to load is a stderr warning under `bbx validate` with exit 0. Closed in
the same session: the doctest also reads `bbx plugins list --json` on the
temp box and fails when any declared stub is not `effective` or the config
has problems. A one-off run with a stub declaring the wrong type name
(`cardSchema("dish", ...)`) showed `validate` exit 0 and
`effective: false`, which the check rejects.

Residual, accepted: none beyond slice 1's (a mis-named stub masked by another
file defining the type).
