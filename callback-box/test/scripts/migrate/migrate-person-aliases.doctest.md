# Migration: rename person `called` to `aliases`

`scripts/migrate/person-aliases.ts` renames the `person` card's `called` field
to the standard `aliases`. `rewriteCardText(fileName, raw)` is the pure per-card
entry: it returns the rewritten text, or `null` when nothing changed (idempotent).

```ts setup
import { rewriteCardText } from "../../../scripts/migrate/person-aliases.js";

const CARD = `---
status: active
name: Kwame Boateng
called:
  - Noor
  - Ma
role: boxholder's mother
---
Notes about Noor.
`;
```

## `called` becomes `aliases`, value preserved, body untouched

```ts
rewriteCardText("Mary_Knox.person.card", CARD)
=>
---
status: active
name: Kwame Boateng
role: boxholder's mother
aliases:
  - Noor
  - Ma
---
Notes about Noor.
```

## Re-running on the output is a no-op (idempotent)

```ts
rewriteCardText("Mary_Knox.person.card", rewriteCardText("Mary_Knox.person.card", CARD))
=> null
```

## A card with no `called` is left untouched (idempotent)

```ts
rewriteCardText("Priya.person.card", "---\nname: Priya\naliases:\n  - Priya L\n---\nbody\n")
=> null
```

## A scalar `called` is normalized to a one-element array (schema requires array)

```ts
rewriteCardText("Dad.person.card", "---\nname: Dad\ncalled: Pop\n---\nb\n")
=>
---
name: Dad
aliases:
  - Pop
---
b
```

## A flow-sequence `called` migrates too

```ts
rewriteCardText("Priya.person.card", "---\nname: Priya\ncalled: [Priya, Augusta]\n---\nb\n")
=>
---
name: Priya
aliases:
  - Priya
  - Augusta
---
b
```

## When both `called` and `aliases` exist, they merge (dedupe) — no data loss

```ts
rewriteCardText("X.person.card", "---\nname: X\naliases:\n  - Noor\ncalled:\n  - Ma\n  - Noor\n---\nb\n")
=>
---
name: X
aliases:
  - Noor
  - Ma
---
b
```

## Only person cards are touched

```ts
rewriteCardText("Home.place.card", "---\nname: Home\ncalled:\n  - house\n---\nb\n")
=> null
```
