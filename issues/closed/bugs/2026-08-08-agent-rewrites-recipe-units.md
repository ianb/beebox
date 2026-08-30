---
title: "Agent silently rewrites user-supplied measurements when structuring a recipe"
workstream: integration-tests
area: beebox
filed-by: agent
discovered-in: worktree-integration-tests — field-test operator prototype (Priya, activity 1)
labels: [field-test-findings, agent-behavior]
resolution: implemented
---

> **Closed 2026-08-09** in `73f4e8e0`: THE LAW OF QUOTING gained a
> data-fidelity bullet (user-supplied values stay as given when structured
> into card fields; convert only on request, visibly), and the recipe
> schema's instructions gained a concrete Fidelity section naming this exact
> case. Verified by a new `law-data-fidelity-units` knowledge audit — pass,
> knows_directly, 0 file reads.
>
> **Correction (same day, from cross-model review):** the finding was
> mis-attributed. The run's stored card was faithful all along
> (`unit="tbsp"`, `amount="1/2"` — the user's exact words); the "1 T" /
> "½ c" the operator saw came from the recipe *renderer*'s display-time
> abbreviation map, not from the agent. The guidance above stands as a
> preventive rule, but the observed symptom is the renderer's — now tracked
> in [recipe-view-abbreviates-units](2026-08-09-recipe-view-abbreviates-units.md).

Saving an uploaded recipe text file as a `.recipe.card`, the agent rewrote the
user's measurements into abbreviations: "1 tbsp dried oregano" → "1 T dried
oregano", "1 cup green olives" → "1 c green olives", "1/2 cup" → "½ c".

The user's own words were preserved verbatim in the notes section (good, and
labeled as verbatim), but the structured ingredients were normalized without
being asked. "1 T" vs "1 t" is a real cooking hazard, and silent edits to
user-supplied quantities undermine trust in everything else the agent stored.

Not obvious where the rewriting impulse comes from — the recipe schema's
`instructions`, a template, or model default. Wherever it lives, the guidance
should be: preserve the user's units/wording in structured fields unless
conversion is requested; normalization is a change to surface, not perform
silently. (Fits the "fabricated free-form value — does the design make honesty
easy" lens: schema instructions should make fidelity the easy path.)
