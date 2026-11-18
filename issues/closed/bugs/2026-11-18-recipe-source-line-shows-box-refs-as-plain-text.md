---
title: "A recipe's Source line shows an in-box ref as plain text, not a link"
workstream: card-source-chips
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-card-source-chips — deciding which card views get the header Sources line
design: ../../../beebox/docs/implemented-plans/card-source-chips.md
resolution: implemented
---

**Closed (implemented, 2026-11-18):** ccea0feb8: recipe Source line renders in-box refs via CardLink (opens in app) and shows notes; kept the recipe's own line rather than the shared Sources line

A recipe card draws its own "Source:" line at the top of its view (`beebox/src/plugins/recipe/view.tsx:55`). `recipeSources` (line 109) keeps an entry's `label`, else `href`, else `ref`, and links only an `href`. A source with a `ref` to a scanned page or another card in the box shows as its raw path, and tapping it does nothing. A `note` is dropped.

Other card types now show their sources under the title as chips that open in the app (plan:card-source-chips). Recipe is left out of that Sources line because its view already draws its own source line, and two lines would repeat each other.

Two ways out: make the recipe line's `ref` entries open in the app (and show notes), or remove the recipe line and let recipes take the shared Sources line (`cardShowsSourcesSection` in `beebox/src/frontend/src/lib/source-chips.ts`). The second also needs an answer for an embedded recipe, which has no card header.
