# Migration: retype recipe `source` / `hero-image`

`scripts/migrate/recipe-source-shape.ts` converts the recipe card's freeform
string `source:` and `hero-image:` into typed objects. `rewriteRecipeText(fileName, raw)`
is the pure per-card entry: it returns the rewritten text, or `null` when nothing
changed (idempotent).

```ts setup
import { rewriteRecipeText } from "../../../scripts/migrate/recipe-source-shape.js";
```

## A freeform string `source` becomes `{ label }`

```ts
rewriteRecipeText("Stew.recipe.card", "---\ntitle: Stew\nsource: The Kitchen\n---\nbody\n")
=>
---
title: Stew
source:
  label: The Kitchen
---
body
```

## A URL `source` becomes `{ href }`

```ts
rewriteRecipeText("Stew.recipe.card", "---\ntitle: Stew\nsource: https://example.com/stew\n---\nb\n")
=>
---
title: Stew
source:
  href: https://example.com/stew
---
b
```

## A path `hero-image` becomes `{ ref }`; a URL becomes `{ href }`

```ts
rewriteRecipeText("A.recipe.card", "---\ntitle: A\nhero-image: attach/finished.jpg\n---\nb\n")
=>
---
title: A
hero-image:
  ref: attach/finished.jpg
---
b

rewriteRecipeText("A.recipe.card", "---\ntitle: A\nhero-image: https://example.com/p.jpg\n---\nb\n")
=>
---
title: A
hero-image:
  href: https://example.com/p.jpg
---
b
```

## Already-object `source` is left untouched (idempotent)

```ts
rewriteRecipeText("Stew.recipe.card", rewriteRecipeText("Stew.recipe.card", "---\ntitle: Stew\nsource: The Kitchen\n---\nbody\n"))
=> null
```

## A recipe with neither field is left untouched

```ts
rewriteRecipeText("Plain.recipe.card", "---\ntitle: Plain\ntags:\n  - quick\n---\nb\n")
=> null
```

## Only recipe cards are touched

```ts
rewriteRecipeText("Note.doc.card", "---\ntitle: Note\nsource: somewhere\n---\nb\n")
=> null
```
