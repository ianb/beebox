---
title: "Scaling a recipe leaves the yield line at the base amount"
workstream: unattached
area: callback-box
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — exercising the recipe card's scale control
resolution: implemented
---

The recipe view's scale buttons (0.5x … 3x) scale the ingredient amounts but not
the yield. At 2x on a recipe with a base of 6, the ingredients double and the
yield line still reads "Yield (base 6) 6 servings", so the card states a serving
count that does not match the quantities beside it.

`RecipeView` provides the multiplier through `RecipeScaleContext`
(`callback-box/src/frontend/src/components/RecipeView.tsx:77`). `Ingredient`
reads it (`callback-box/src/frontend/src/components/RecipeTags.tsx:113`);
`RecipeYield` does not — it renders `children` verbatim plus the `amount`
attribute as "(base N)"
(`callback-box/src/frontend/src/components/RecipeTags.tsx:172-188`).

The schema calls the yield "the scaling base"
(`callback-box/src/schemas/recipe.tsx:83`), and the tag carries a machine-readable
`amount`, so the number needed to scale it is already there.
