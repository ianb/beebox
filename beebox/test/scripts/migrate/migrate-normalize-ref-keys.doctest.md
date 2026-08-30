# Migration: normalize card references onto a `ref` key

`scripts/migrate/normalize-ref-keys.ts` rewrites the two historical card-ref
shapes that stored a reference under a non-`ref` key into the canonical
`{ ref: <path> }` form. `rewriteCardText(fileName, raw)` is the pure per-card
entry: it returns the rewritten text, or `null` when nothing changed (so the
migration is idempotent).

```ts setup
import { rewriteCardText } from "../../../scripts/migrate/normalize-ref-keys.js";
```

## Landmark: `destinations[].procedure-ref` becomes `procedure: { ref }`

```ts
const LANDMARK = `---
navigation:
  label: Recipes
destinations:
  - for: [triage]
    rules: Cooking instructions.
    procedure-ref: archive-recipe.procedure.card
  - for: [commentary]
---
`;
const out = rewriteCardText("Recipes.landmark.card", LANDMARK);
out
=>
---
navigation:
  label: Recipes
destinations:
  - for:
      - triage
    rules: Cooking instructions.
    procedure:
      ref: archive-recipe.procedure.card
  - for:
      - commentary
---
```

A landmark already nested as `procedure: { ref }` is left untouched (idempotent):

```ts continue
rewriteCardText("Recipes.landmark.card", out) === null
=> true
```

## Webpage: top-level `frozen: <string>` becomes `frozen: { ref }`

```ts
const WEBPAGE = `---
title: Foo
source: https://example.com/foo
frozen: attach/page.frozen
---
Body.
`;
const out2 = rewriteCardText("Foo.webpage.card", WEBPAGE);
out2
=>
---
title: Foo
source: https://example.com/foo
frozen:
  ref: attach/page.frozen
---
Body.
```

An already-nested `frozen: { ref }` is left untouched (idempotent):

```ts continue
rewriteCardText("Foo.webpage.card", out2) === null
=> true
```

## Other card types and cards without the legacy fields are skipped

```ts
rewriteCardText("Notes.memo.card", "---\ntitle: Notes\n---\nbody\n") === null
=> true

rewriteCardText("Bare.webpage.card", "---\nsource: https://example.com/x\n---\nbody\n") === null
=> true
```
