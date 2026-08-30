---
title: "Recipe view abbreviates units at display time (tbsp → \"T\", 1/2 → \"½\")"
workstream: integration-tests
area: beebox
filed-by: agent
discovered-in: worktree-integration-tests — cross-model review of the category-2 field-test fixes
labels: [field-test-findings, ui-sensibility]
resolution: implemented
---

> **Closed 2026-08-09** — boxholder picked the middle option ("totally fine
> to use Tbsp and tsp and cup"): the display map never produces single-letter
> forms — long forms compact to `Tbsp`/`tsp`, `cup` stays a word, and stored
> single letters ("T"/"t", case-sensitively) EXPAND to the safe form, so
> legacy cards de-hazard at render. Unambiguous `mL`/`oz`/`L`/`kg` keep their
> standard short forms; unicode fractions were judged fine and stay.
> Verified live: a stored `unit="T"` renders "3 Tbsp olive oil".
The recipe renderer normalizes faithfully-stored ingredients when it displays
them: `UNIT_ABBREV` in
`beebox/src/frontend/src/components/RecipeTags.tsx` maps
`tablespoon`/`tbsp` → `T`, `teaspoon`/`tsp` → `t`, `cup` → `c`, and
`formatFraction` swaps `1/2` → `½` via `UNICODE_FRACTIONS`.

This is what the first field-test run's operator actually saw. The stored card
was faithful (`unit="tbsp"`, `amount="1/2"` — the user's own words); the
"1 T dried oregano" in the UI came entirely from the renderer. The original
finding
([agent-rewrites-recipe-units](2026-08-08-agent-rewrites-recipe-units.md))
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
