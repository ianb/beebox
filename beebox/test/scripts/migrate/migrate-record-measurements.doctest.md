# Migration: rename record `measures` to `measurements`

`scripts/migrate/record-measurements.ts` renames the `record` card's
`measures` field to `measurements` (the vocabulary sweep's field split —
`quantity` is new and optional, so only the rename needs migrating).
`rewriteCardText(fileName, raw)` is the pure per-card entry: it returns the
rewritten text, or `null` when nothing changed (idempotent).

```ts setup
import { rewriteCardText } from "../../../scripts/migrate/record-measurements.js";

const CARD = `---
status: draft
name: Glue Sticks
measures:
  - value: 4 sticks
location:
  text: junk drawer
---
Body notes.
`;
```

## `measures` becomes `measurements`, entries verbatim, body untouched

```ts
rewriteCardText("Glue_Sticks.record.card", CARD)
=>
---
status: draft
name: Glue Sticks
location:
  text: junk drawer
measurements:
  - value: 4 sticks
---
Body notes.
```

## Re-running on the output is a no-op (idempotent)

```ts
rewriteCardText("Glue_Sticks.record.card", rewriteCardText("Glue_Sticks.record.card", CARD))
=> null
```

## A card with no `measures` is left untouched (idempotent)

```ts
rewriteCardText("Ladder.record.card", "---\nname: Ladder\nmeasurements:\n  - value: 7 feet\n---\n")
=> null
```

## Entry `note`s survive the rename

```ts
rewriteCardText("Ladder.record.card", "---\nname: Ladder\nmeasures:\n  - value: 45 pounds\n    note: shipping weight\n---\nb\n")
=>
---
name: Ladder
measurements:
  - value: 45 pounds
    note: shipping weight
---
b
```

## When both keys exist, lists concatenate (existing first) — no data loss

```ts
rewriteCardText("X.record.card", "---\nname: X\nmeasurements:\n  - value: 2 pages\nmeasures:\n  - value: 7 feet\n---\nb\n")
=>
---
name: X
measurements:
  - value: 2 pages
  - value: 7 feet
---
b
```

## Only record cards are touched

```ts
rewriteCardText("Home.place.card", "---\nname: Home\nmeasures:\n  - value: 2 acres\n---\nb\n")
=> null
```
