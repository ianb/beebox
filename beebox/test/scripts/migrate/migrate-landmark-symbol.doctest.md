# Migration: a landmark's mark moves onto the card

`scripts/migrate/landmark-symbol.ts` moves `navigation.symbol` to the card's own
`symbol` group, now that every card may carry one. `rewriteLandmarkSymbol` is
the whole decision as a pure function of the card's text; the harness around it
only reads and writes files.

```ts setup
import { rewriteLandmarkSymbol } from "../../../scripts/migrate/landmark-symbol.js";

/** The rewritten card, or "(unchanged)" when nothing needed moving. */
function rewrite(card: string): string {
  return rewriteLandmarkSymbol(card).text ?? "(unchanged)";
}
```

## A text symbol becomes a glyph

Only the two keys move: every other line keeps its formatting, because the
migrator edits the YAML document in place rather than re-stringifying it.

```ts
rewrite(`---
navigation:
  label: Recipes
  symbol: 🍳
  links:
    - ref: /_content/recipes/Bread.recipe.card
      label: the bread
---
`)
=> ---
navigation:
  label: Recipes
  links:
    - ref: /_content/recipes/Bread.recipe.card
      label: the bread
symbol:
  glyph: 🍳
---
```

## An image symbol becomes a src, ref form untouched

The ref is moved verbatim — resolution is the reader's job, and rewriting a
path here would be a second place for the 3-form rule to be got wrong.

```ts
rewrite(`---
navigation:
  label: Seminar
  symbol:
    src: /_content/marks/seminar.webp
---
`)
=> ---
navigation:
  label: Seminar
symbol:
  src: /_content/marks/seminar.webp
---
```

## A navigation role that held nothing else goes away with it

```ts
rewrite(`---
navigation:
  symbol: 📦
---
`)
=> ---
symbol:
  glyph: 📦
---
```

## Idempotent, and quiet about cards with no mark

A second run finds nothing to move. So does a landmark that never had a symbol,
and a file that is not a card at all.

```ts
const migrated = `---
navigation:
  label: Recipes
symbol:
  glyph: 🍳
---
`;
rewrite(migrated)
=> (unchanged)

rewrite(`---
navigation:
  label: Recipes
---
`)
=> (unchanged)

rewrite("no frontmatter here")
=> (unchanged)
```

## The body is preserved

Landmarks are usually body-less, but nothing guarantees it.

```ts
rewrite(`---
navigation:
  symbol: 📦
---

Some prose about this spot.
`)
=> ---
symbol:
  glyph: 📦
---
«blankline»
Some prose about this spot.
```

## What it refuses to guess

A symbol shape the migrator does not recognise is dropped with a warning rather
than moved as-is — the harness prints these at the end of a run, so the loss is
never silent.

```ts
const odd = rewriteLandmarkSymbol(`---
navigation:
  symbol:
    weird: yes
---
`);
odd.warnings.join("\n")
=> navigation.symbol is neither text nor { src } — dropping: {"weird":"yes"}
```

A card that already carries its own symbol keeps it: the readers prefer the
card's own field, so overwriting it would lose the newer value.

```ts continue
const both = rewriteLandmarkSymbol(`---
navigation:
  label: Recipes
  symbol: 🍳
symbol:
  glyph: 🥖
---
`);
both.warnings.join("\n")
=> card already has its own symbol — keeping it and dropping navigation.symbol

both.text
=> ---
navigation:
  label: Recipes
symbol:
  glyph: 🥖
---
```
