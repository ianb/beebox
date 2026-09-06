# The `prominence` budget lint (`core/lint-prominence.ts`)

Box-level rules that catch the case where many individually-reasonable local
decisions add up wrong — a directory with too many entry points or primary
cards, a card marked prominent under a place the box has folded away, a mark
that has no effect where it was written. Every rule here is a warning.

```ts setup
import {
  lintProminenceBudget,
  MAX_ENTRY_POINTS_PER_DIR,
  MAX_PRIMARY_PER_DIR,
} from "../../src/core/lint-prominence.js";
import { buildLoadContext } from "../../src/core/load-context.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

/** The warnings for a box, as "rule: path: message" lines, sorted for stable output. */
async function warningsFor(box) {
  const ctx = await buildLoadContext(box.root);
  const warnings = await lintProminenceBudget(box.root, ctx);
  return warnings.map((w) => `${w.rule}: ${w.path}: ${w.message}`).join("\n");
}
```

## A clean box says nothing

Two entry points and seven primary cards are each within budget; a card with
no `prominence` at all is ordinary and never counted.

```ts
const box = await makeTmpBox();
await box.write("_content/notes/Index.memo.card", "---\nprominence: entry-point\n---\n");
await box.write("_content/notes/Overview.memo.card", "---\nprominence: entry-point\n---\n");
await box.write("_content/notes/P1.memo.card", "---\nprominence: primary\n---\n");
await box.write("_content/notes/P2.memo.card", "---\nprominence: primary\n---\n");
await box.write("_content/notes/P3.memo.card", "---\nprominence: primary\n---\n");
await box.write("_content/notes/P4.memo.card", "---\nprominence: primary\n---\n");
await box.write("_content/notes/P5.memo.card", "---\nprominence: primary\n---\n");
await box.write("_content/notes/P6.memo.card", "---\nprominence: primary\n---\n");
await box.write("_content/notes/P7.memo.card", "---\nprominence: primary\n---\n");
await box.write("_content/notes/Aside.memo.card", "---\ntitle: Aside\n---\n");
await warningsFor(box)
=>
```

```ts cleanup
await box.cleanup();
```

## Too many entry points in one directory

`MAX_ENTRY_POINTS_PER_DIR` is 2; a third is the exceptional case the lint
warns about.

```ts
MAX_ENTRY_POINTS_PER_DIR
=> 2

const box2 = await makeTmpBox();
await box2.write("_content/notes/A.memo.card", "---\nprominence: entry-point\n---\n");
await box2.write("_content/notes/B.memo.card", "---\nprominence: entry-point\n---\n");
await box2.write("_content/notes/C.memo.card", "---\nprominence: entry-point\n---\n");
await warningsFor(box2)
=> too-many-entry-points: _content/notes: 3 entry points in one directory; an entry point is where a newcomer starts, and a directory usually has one
```

```ts cleanup
await box2.cleanup();
```

## Too many primary cards in one directory

`MAX_PRIMARY_PER_DIR` is 7; an eighth trips the warning.

```ts
MAX_PRIMARY_PER_DIR
=> 7

const box3 = await makeTmpBox();
await box3.write("_content/notes/P1.memo.card", "---\nprominence: primary\n---\n");
await box3.write("_content/notes/P2.memo.card", "---\nprominence: primary\n---\n");
await box3.write("_content/notes/P3.memo.card", "---\nprominence: primary\n---\n");
await box3.write("_content/notes/P4.memo.card", "---\nprominence: primary\n---\n");
await box3.write("_content/notes/P5.memo.card", "---\nprominence: primary\n---\n");
await box3.write("_content/notes/P6.memo.card", "---\nprominence: primary\n---\n");
await box3.write("_content/notes/P7.memo.card", "---\nprominence: primary\n---\n");
await box3.write("_content/notes/P8.memo.card", "---\nprominence: primary\n---\n");
await warningsFor(box3)
=> too-many-primary: _content/notes: 8 primary cards in _content/notes; primary is the thing itself, not everything good — if everything here is the thing, mark nothing and give the directory an entry point
```

```ts cleanup
await box3.cleanup();
```

## `primary`/`entry-point` under a `background` landmark

A landmark explicitly marked `prominence: background` folds the whole place
away — a card under it still marked prominent is a warning naming both
cards.

```ts
const box4 = await makeTmpBox();
await box4.write("_content/logs/Logs.landmark.card", "---\nprominence: background\n---\n");
await box4.write("_content/logs/Run.memo.card", "---\nprominence: primary\n---\n");
await warningsFor(box4)
=> under-background-landmark: _content/logs/Run.memo.card: _content/logs/Run.memo.card is marked primary, but its landmark _content/logs/Logs.landmark.card is marked prominence: background — a background place folds away everything under it
```

A card under an ordinary (unmarked) landmark is unaffected — the cascade is
only for a landmark that WROTE `background`, not every landmark (a landmark
is background BY TYPE, but that describes the file, not the place).

```ts continue
const box5 = await makeTmpBox();
await box5.write("_content/recipes/Recipes.landmark.card", "---\nnavigation:\n  label: Recipes\n---\n");
await box5.write("_content/recipes/Bread.recipe.card", "---\nprominence: primary\n---\n");
await warningsFor(box5)
=>
```

```ts cleanup
await box4.cleanup();
await box5.cleanup();
```

## `entry-point`/`primary` written on a landmark card itself

A landmark marks a place, not a visitable file — its own `prominence` is
either absent or `background`; writing `entry-point` or `primary` on it is a
misunderstanding of the field.

```ts
const box6 = await makeTmpBox();
await box6.write("_content/recipes/Recipes.landmark.card", "---\nprominence: entry-point\n---\n");
await warningsFor(box6)
=> landmark-prominence: _content/recipes/Recipes.landmark.card: a landmark marks a place; the place's entry point is a visitable card inside it
```

```ts cleanup
await box6.cleanup();
```

## `primary`/`entry-point` inside an OWNED attach scope has no effect

`Foo.attach/` is owned when a sibling card's basename is `Foo`. A prominence
mark inside it is invisible to every reader, since the scope is folded into
its owner.

```ts
const box7 = await makeTmpBox();
await box7.write("_content/projects/Foo.memo.card", "---\ntitle: Foo\n---\n");
await box7.write("_content/projects/Foo.attach/Note.memo.card", "---\nprominence: primary\n---\n");
await warningsFor(box7)
=> inside-attach-scope: _content/projects/Foo.attach/Note.memo.card: prominence inside an attach scope has no effect; mark the owner card, or list it in the landmark's `links:`
```

An UNOWNED `.attach/`-suffixed directory (no sibling card named `Foo`) is not
a real attach scope for this rule's purposes — nothing to warn about.

```ts continue
const box8 = await makeTmpBox();
await box8.write("_content/projects/Foo.attach/Note.memo.card", "---\nprominence: primary\n---\n");
await warningsFor(box8)
=>
```

An owned attach scope that holds its OWN landmark is that landmark's home
(`prunedSubtree` walks it), so a mark inside it feeds the landmark's derived
list and is not warned about.

```ts continue
const box8b = await makeTmpBox();
await box8b.write("_content/courses/Foo.course.card", "---\ntitle: Foo\n---\n");
await box8b.write("_content/courses/Foo.attach/Foo.landmark.card", "---\nnavigation:\n  label: Foo\n---\n");
await box8b.write("_content/courses/Foo.attach/Plan.memo.card", "---\nprominence: primary\n---\n");
await warningsFor(box8b)
=>
```

```ts cleanup
await box7.cleanup();
await box8.cleanup();
await box8b.cleanup();
```

## A `background` root landmark

The root landmark lives directly in `_content/`. Marking it `background`
folds the whole box away everywhere the root landmark's place is consulted.

```ts
const box9 = await makeTmpBox();
await box9.write("_content/Box.landmark.card", "---\nprominence: background\n---\n");
await warningsFor(box9)
=> background-root-landmark: _content/Box.landmark.card: the root landmark is marked prominence: background — that folds the whole box away everywhere the root landmark's place is consulted; remove it, or confirm the box is meant to open empty
```

A landmark elsewhere in the tree marked `background` is an ordinary
housekeeping place, not the root — no root-specific warning.

```ts continue
const box10 = await makeTmpBox();
await box10.write("_content/logs/Logs.landmark.card", "---\nprominence: background\n---\n");
await warningsFor(box10)
=>
```

```ts cleanup
await box9.cleanup();
await box10.cleanup();
```

## A `background` landmark cascades through an intervening non-background landmark

`_content/A` is `background`; `_content/A/B` has its OWN (non-background)
landmark; a `primary` card two levels down in `_content/A/B/C` is still
under `A`'s cascade even though the nearest landmark isn't the background
one.

```ts
const box11 = await makeTmpBox();
await box11.write("_content/A/A.landmark.card", "---\nprominence: background\n---\n");
await box11.write("_content/A/B/B.landmark.card", "---\nnavigation:\n  label: B\n---\n");
await box11.write("_content/A/B/C/Deep.memo.card", "---\nprominence: primary\n---\n");
await warningsFor(box11)
=> under-background-landmark: _content/A/B/C/Deep.memo.card: _content/A/B/C/Deep.memo.card is marked primary, but its landmark _content/A/A.landmark.card is marked prominence: background — a background place folds away everything under it
```

```ts cleanup
await box11.cleanup();
```

## A redundant `links:` entry — info, not a warning

The landmark links its own `Plan.memo.card`, which is already marked
`primary` and inside the landmark's pruned subtree, with no label: the
derived list already shows it, so the entry is redundant.

```ts
const box12 = await makeTmpBox();
await box12.write(
  "_content/proj/Proj.landmark.card",
  "---\nnavigation:\n  label: Proj\n  links:\n    - ref: /_content/proj/Plan.memo.card\n---\n",
);
await box12.write("_content/proj/Plan.memo.card", "---\nprominence: primary\n---\n");
await warningsFor(box12)
=> redundant-link: _content/proj/Proj.landmark.card: link to _content/proj/Plan.memo.card is redundant with the target's own prominence: primary — the derived list already surfaces it
```

A LABELED entry, or one pointing outside the landmark's pruned subtree
(a nested landmark's territory), is not flagged.

```ts continue
const box13 = await makeTmpBox();
await box13.write(
  "_content/proj/Proj.landmark.card",
  "---\nnavigation:\n  label: Proj\n  links:\n    - ref: /_content/proj/Plan.memo.card\n      label: the plan\n---\n",
);
await box13.write("_content/proj/Plan.memo.card", "---\nprominence: primary\n---\n");
await warningsFor(box13)
=>
```

```ts cleanup
await box12.cleanup();
await box13.cleanup();
```
