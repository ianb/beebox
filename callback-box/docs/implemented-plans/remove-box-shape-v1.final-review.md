---
title: "Final review — remove-box-shape-v1 (Codex, gpt-5.6-sol, 2026-07-11)"
status: implemented
workstream: unknown
issues: []
---
# Final review — remove-box-shape-v1 (Codex, gpt-5.6-sol, 2026-07-11)

Holistic review of the complete v1 removal (steps 1a–1e; the 1a+1b core was
reviewed separately in `.core-review.md`). Focus: 1c/1d/1e and overall
completeness/safety.

## Verdict
> Not safe to land until `initBox` restores early strict validation and removes
> the remaining `shapeVersion` override; after that, the runtime removal is safe
> and the documented residue/slug issues may remain separate follow-ups.

Both required fixes applied (below); re-verified green.

## Verified safe (verbatim highlights)
- **1c is behaviorally equivalent.** Every real-box path (listViews, views route,
  `cb view test`) constructs `box-package` from the validated shape; direct
  compiler calls without a box retain the engine-hosted double-symlink. No caller
  left depending on `defaultBoxShape`.
- **Resolve-hook removal is safe for v2.** Its call was exclusively under
  `shapeVersion === 1`, and the hook only matched parents under `/config/schemas/`.
  V2 schemas load from `<packageRoot>/src/schemas` and resolve `callback-box/*`
  via `<packageRoot>/node_modules/callback-box` + the package export map. (This
  was the highest-risk deletion — cleared.)
- `ensureDirectories`' unconditional `.claude` skip is identical to its prior v2
  arm; no other callers.
- The guide collapses preserve the v2 tracker paths; removing the inactive v1
  ledger keys doesn't weaken the managed-template forcing function.
- The v2 slug issue predates this range (already `basename(boxRoot)`); correctly
  separate.

## Findings + disposition
1. **Medium (BLOCKER) — 1d dropped `initBox`'s early strict validation and kept a
   v1-construction API.** Collapsing `ensureDirectories` removed the early
   `getBoxShape`, so `initBox` created dirs/manifest/config before the strict
   check fired deep in `installTricksFiles` — a bad parent package or stale marker
   left a half-written box. `InitOptions.shapeVersion` still accepted any number.
   → FIXED: removed `shapeVersion` from `InitOptions` (marker always writes 2),
   updated the two `{shapeVersion:2}` callers (`package.ts`, `hub-e2e.doctest.md`),
   and restored `await getBoxShape(resolvedRoot)` immediately after marker
   handling so a bad init fails before any mutation. init/box doctests green.
2. **Low — incomplete cleanup.** `health-engine.ts` still wrapped the engine-link
   check in `shapeVersion >= 2` (dead; my step-1d grep for `=== 1` missed the
   `>= 2` form), and two doctest descriptions (`init-v2`, `healthz-engine-version`)
   still asserted legacy support. → FIXED: unwrapped the health-engine branch;
   reworded both descriptions to the v2-only reality.

The filed follow-ups (src comment residue, external scenario boxes, the slug
issue) are correctly separate and do not hide a regression this diff introduced.
