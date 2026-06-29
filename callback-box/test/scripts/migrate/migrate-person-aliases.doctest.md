# Migration: rename person `called` to `aliases`

`scripts/migrate/person-aliases.ts` renames the `person` card's `called` field
to the standard `aliases`. `rewriteCardText(fileName, raw)` is the pure per-card
entry: it returns the rewritten text, or `null` when nothing changed (idempotent).

```ts setup
import { rewriteCardText } from "../../../scripts/migrate/person-aliases.js";
```

## `called` becomes `aliases`, value preserved, body untouched

```ts
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
const out = rewriteCardText("Mary_Knox.person.card", CARD);
out
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

## A card with no `called` is left untouched (idempotent)

```ts
rewriteCardText("Priya.person.card", "---\nname: Priya\naliases:\n  - Priya L\n---\nbody\n")
=> null
```

## Only person cards are touched

```ts
rewriteCardText("Home.place.card", "---\nname: Home\ncalled:\n  - house\n---\nb\n")
=> null
```
