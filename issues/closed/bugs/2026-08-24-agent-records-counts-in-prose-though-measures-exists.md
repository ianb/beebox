---
title: "Records have a quantity field and the agent used it on 2 of 20 inventory items"
workstream: vocab-sweep
resolution: implemented
area: beebox
labels: [soft-launch, journey-findings]
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — journey B, 2026-08-24 walk
---

> **Closed 2026-09-02 (vocab-sweep).** Resolved by the record schema change
> (`src/schemas/record.tsx`): a new single-value `quantity` field answers
> "how many do I have", `measures` renamed to `measurements` (Track B,
> `beebox/docs/implemented-plans/vocab-glossary-sweep.md`), migration
> `record-measurements` registered and doctested, applied on the worktree
> test1 clone. Knowledge audit `record-quantity-field` passes against a live
> box agent.

When I ask how many of something I have, I want the box to have kept the
number as a number, so the answer does not depend on re-reading a paragraph I
wrote months ago.

`record.tsx` already supports this. The `measures` field is an array of
`{value, note?}` where `value` is natural language carrying the number and its
unit together — the schema's own examples are `"2 pages"`, `"7 feet"`,
`"1200 USD"`, `"45 pounds"`, `"12 servings"`. That shape handles both "4" and
"4 litres" without forcing a numeric type, which is the right call.

**The field is barely used.** Of the 20 inventory records the 2026-08-24 walk
produced, **2 carry `measures`.** The glue sticks did, correctly:

```yaml
measures:
  - value: "4 sticks"
```

The other 18 keep their counts in prose. `Pens_and_Markers.record.card` says
"A large assortment (roughly 15–20)" in `description:` and has no `measures:`.

So the failure is application, not schema — which makes it an agent-guidance
problem. Two things worth checking in `record.tsx`'s `instructions`:

- `measures` is introduced as "A measurement, quantity, dimension, weight,
  price, or count" — accurate and general, and general is the problem. Nothing
  connects it to the commonest inventory question there is, "how many do I
  have", so a count reads as prose-worthy detail rather than a field.
- **The name is part of it.** "Measures" reads as measurements — dimensions,
  weights, a thing's size — not as "four of them". The boxholder, who knew a
  quantity field existed, did not expect it to be called this. If the field the
  agent should reach for when counting is named after measuring, reaching for it
  requires a translation step that prose does not. Worth considering alongside
  the wider vocabulary work
  ([implementation-vocab-leaks-into-ui](2026-08-08-implementation-vocab-leaks-into-ui.md)),
  since renaming a schema field is a migration, not a wording change.
- The walk's agent described its plan as "one card for glue sticks, qty 4" and
  offered a card type "with location and quantity fields". It knew the intent.
  It populated `measures` for that item and then largely stopped.

Why it matters more later than now: a count in prose cannot be summed, sorted,
or noticed as stale, and "I'm down to three" becomes a sentence rewrite rather
than a field edit. Twenty records is recoverable. Six containers of them, after
months of corrections, is a migration.

**Correction to the record.** This was first filed as a missing-field feature
request, claiming records had nowhere to put a count and that the agent had
promised a field that did not exist. Both were wrong — the field exists and the
agent did use it. The claim came from reading one record and generalising. The
boxholder, who thought quantity was already a thing, was right.


> 2026-09-02 survey (bbx-pick-issues): still true; `measures` schema instructions unchanged. Grouped with 2026-08-08-implementation-vocab-leaks-into-ui (same class: internal names not translated for the user).
