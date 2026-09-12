---
description: "Keep your own recipes as cards that rescale the amounts, carry your substitutions, and are readable from a phone in the kitchen."
---
# Cooking from your recipes

Your recipes are in six places: a browser tab, a screenshot, a relative's
handwriting, a cookbook, your memory. When you actually cook you want one of
them, scaled for the number at the table, with the substitution you always make
already written in. A **box** is one directory of your data, a **card** is one
markdown file in it, and **the agent** is the coding agent that writes the recipe
card from whatever you hand it.

**What you do.** Paste a recipe, photograph a page, dictate one, or point the
box at a web page. Say how many you are cooking for. Say what you substituted,
what went wrong, and what you would do differently, in whatever words you use.
Cook from the card on a phone propped up in the kitchen.

**What the box does.** The recipe becomes a recipe card whose body uses a small
set of markup tags: a yield, per-ingredient amounts, steps, substitutions, and
links to sub-recipes. The recipe view reads those tags, so choosing a different
serving count rewrites the ingredient amounts, converting units and keeping
fractions sensible. Substitutions can be written into the card; whether the
view shows them has not been checked (see below). Recipes are filed together, and a landmark over that
directory makes the collection something to browse. Remarks that fit no field
stay on the card as your own words.

**What it needs.** Nothing beyond the box itself.
[Recipes](../capabilities/recipes.md), [views](../capabilities/views.md),
[what it requires](../08-what-it-requires.md).

**Where it is still rough.** Ingredient rescaling is verified working; the yield
line itself does not rescale with it, so a recipe scaled to half still prints its
original serving count. The substitution markup exists in the card format but has
not been seen rendering in a checked box, so treat it as written-but-unexercised.
There is no nutrition calculation, meal planning, or shopping-list generation;
those would be a view or a procedure someone asked for. A photographed recipe
page goes through the same image handling as any photo, which currently renders
some rotated photos upside down.

**Read next.** [Phone capture](../capabilities/phone-capture.md),
[recipe](../reference/cards/recipe.md).
