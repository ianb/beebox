---
title: "Recipe view abbreviates units at display time (tbsp → \"T\", 1/2 → \"½\")"
area: callback-box
filed-by: agent
discovered-in: worktree-integration-tests — cross-model review of the category-2 field-test fixes
labels: [field-test-findings, ui-sensibility]
---

The recipe renderer normalizes faithfully-stored ingredients when it displays
them: `UNIT_ABBREV` in
`callback-box/src/frontend/src/components/RecipeTags.tsx` maps
`tablespoon`/`tbsp` → `T`, `teaspoon`/`tsp` → `t`, `cup` → `c`, and
`formatFraction` swaps `1/2` → `½` via `UNICODE_FRACTIONS`.

This is what the first field-test run's operator actually saw. The stored card
was faithful (`unit="tbsp"`, `amount="1/2"` — the user's own words); the
"1 T dried oregano" in the UI came entirely from the renderer. The original
finding
([agent-rewrites-recipe-units](../closed/bugs/2026-08-08-agent-rewrites-recipe-units.md))
mis-attributed it to agent behavior.

The tension: the abbreviation is deliberate compact display for ingredient
lines, but "T" vs "t" is a real cooking hazard — a misread is a 3× error — and
the display contradicts the fidelity rule the agent guide now states ("1 tbsp"
never becomes "1 T"). The user wrote "tbsp"; the app shows them "T".

Options, not decided: drop the abbreviation map and show units as stored;
abbreviate only long-form words (`tablespoon` → `tbsp`, never single-letter
forms); keep abbreviation but never for the T/t pair. Unicode fractions (`½`)
are likely fine — unambiguous, arguably nicer — so the unit map and the
fraction glyphs deserve separate calls.
