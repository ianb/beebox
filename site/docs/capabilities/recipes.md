---
description: "Keeps recipes as structured cards that scale ingredient amounts to any batch size and link to substitutions and sub-recipes."
---
# Recipes

A box is a directory of your data, kept under version control with a full
history of changes (using git); a card is a markdown file with a structured
header; the agent is the coding agent (Claude Code or Codex) that operates the
box. A recipe is a card with a structured body the recipe view understands.

**What it does for you**

- Scales every ingredient amount to a batch size you choose, from a single
  serving count marked in the card.
- Numbers steps automatically and keeps substitutions attached to the
  ingredient or step they apply to, instead of buried in prose.
- Links to a sub-recipe (a sauce inside a larger dish) so it can be reused
  across recipes instead of copy-pasted.
- Records where a recipe came from, whether that's a cookbook, a person, a
  URL, or a captured web page, so its origin isn't lost.

**What it needs**

Nothing beyond the box itself. A recipe is created by the agent from
something you tell it, paste, or have it capture from a web page or photo.

**How it works, briefly**

A recipe card's body uses a small set of markup tags (a serving-size yield,
per-ingredient amounts, steps, substitutions, sub-recipe links) that the
recipe view reads to display and scale the recipe. Recipes are stored in the
box (under `_content/recipes/`, for the curious); the agent files and
organizes them there on request, not on a schedule.

**Limits**

The documentation does not describe nutrition calculation, meal planning, or
a shopping-list generator built on top of recipe cards; those would be
built as separate views or procedures if you asked for them.

**Go deeper**

[../reference/cards/recipe.md](../reference/cards/recipe.md),
[views.md](views.md)
