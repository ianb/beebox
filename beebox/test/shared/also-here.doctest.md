# Choosing the "Also here" cards

`alsoHere(ordinary, { shownRefs, cap })` picks the place page's "Also here"
cards from the pruned walk's ordinary list (docs/implemented-plans/place-shows-cards.md,
Track A): it drops cards already shown, orders the rest most recently changed
first with the path as tie-break, and caps the list while counting all of
them.

```ts setup
import { alsoHere } from "../../src/shared/also-here.js";

const card = (boxPath: string, mtimeMs: number) => ({ boxPath, mtimeMs });
const paths = (cards: { boxPath: string }[]) => cards.map((c) => c.boxPath);
```

## Shown cards are dropped; shown refs have no leading "/"

```ts
const pick = alsoHere(
  [card("/_content/A.memo.card", 1), card("/_content/B.memo.card", 3), card("/_content/C.memo.card", 2)],
  { shownRefs: new Set(["_content/B.memo.card"]), cap: 10 },
);
({ cards: paths(pick.cards), count: pick.count })
=> { cards: ["/_content/C.memo.card", "/_content/A.memo.card"], count: 2 }
```

## The cap limits the cards, not the count

```ts
const pick = alsoHere(
  [card("/a", 1), card("/b", 2), card("/c", 3), card("/d", 4)],
  { shownRefs: new Set(), cap: 2 },
);
({ cards: paths(pick.cards), count: pick.count })
=> { cards: ["/d", "/c"], count: 4 }
```

## Equal mtimes sort by path, numbers by value

```ts
paths(alsoHere([card("/x10", 5), card("/x2", 5), card("/w", 5)], { shownRefs: new Set(), cap: 10 }).cards)
=> ["/w", "/x2", "/x10"]
```

## Nothing left is an empty selection

```ts
alsoHere([card("/a", 1)], { shownRefs: new Set(["a"]), cap: 10 })
=> { cards: [], count: 0 }
```
