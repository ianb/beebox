---
title: "Agent silently rewrites user-supplied measurements when structuring a recipe"
area: callback-box
filed-by: agent
discovered-in: worktree-integration-tests — field-test operator prototype (Priya, activity 1)
labels: [field-test-findings, agent-behavior]
---

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
