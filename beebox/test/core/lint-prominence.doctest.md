# The `prominence` budget lint (`core/lint-prominence.ts`)

Box-level rules that catch the case where many individually-reasonable local
decisions add up wrong — a directory with too many entry points or primary
cards, a card marked prominent under a place the box has folded away, a mark
that has no effect where it was written. Every rule here is a warning.

```ts setup
import { lintProminenceBudget } from "../../src/core/lint-prominence/core.js";
import { buildLoadContext } from "../../src/core/load-context.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

/** Build a throwaway box from a path -> content map and return its warnings as "rule: path: message" lines. */
async function warningsFor(files) {
  const box = await makeTmpBox();
  try {
    for (const [file, content] of Object.entries(files)) await box.write(file, content);
    const ctx = await buildLoadContext(box.root);
    const warnings = await lintProminenceBudget(box.root, ctx);
    return warnings.map((w) => `${w.rule}: ${w.path}: ${w.message}`).join("\n");
  } finally {
    await box.cleanup();
  }
}

/** A card whose frontmatter is just a `prominence` mark. */
const marked = (prominence) => `---\nprominence: ${prominence}\n---\n`;
/** `n` cards P1..Pn in `_content/notes`, all with the given mark. */
const cards = (n, prominence) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`_content/notes/P${i + 1}.memo.card`, marked(prominence)]));
```

## A clean box says nothing

Two entry points and seven primary cards are each within budget; a card with
no `prominence` at all is ordinary and never counted.

```ts
await warningsFor({
  "_content/notes/Index.memo.card": marked("entry-point"),
  "_content/notes/Overview.memo.card": marked("entry-point"),
  ...cards(7, "primary"),
  "_content/notes/Aside.memo.card": "---\ntitle: Aside\n---\n",
})
=>
```

## Too many entry points in one directory

`MAX_ENTRY_POINTS_PER_DIR` is 2; a third is the exceptional case the lint
warns about.

```ts
await warningsFor({
  "_content/notes/A.memo.card": marked("entry-point"),
  "_content/notes/B.memo.card": marked("entry-point"),
  "_content/notes/C.memo.card": marked("entry-point"),
})
=> too-many-entry-points: _content/notes: 3 entry points in one directory; an entry point is where a newcomer starts, and a directory usually has one
```

## Too many primary cards in one directory

`MAX_PRIMARY_PER_DIR` is 7; an eighth trips the warning.

```ts
await warningsFor(cards(8, "primary"))
=> too-many-primary: _content/notes: 8 primary cards in _content/notes; primary is the thing itself, not everything good — if everything here is the thing, mark nothing and give the directory an entry point
```

## `primary`/`entry-point` under a `background` landmark

A landmark explicitly marked `prominence: background` folds the whole place
away — a card under it still marked prominent is a warning naming both
cards.

```ts
await warningsFor({
  "_content/logs/Logs.landmark.card": marked("background"),
  "_content/logs/Run.memo.card": marked("primary"),
})
=> under-background-landmark: _content/logs/Run.memo.card: _content/logs/Run.memo.card is marked primary, but its landmark _content/logs/Logs.landmark.card is marked prominence: background — a background place folds away everything under it
```

A card under an ordinary (unmarked) landmark is unaffected — the cascade is
only for a landmark that WROTE `background`, not every landmark (a landmark
is background BY TYPE, but that describes the file, not the place).

```ts
await warningsFor({
  "_content/recipes/Recipes.landmark.card": "---\nnavigation:\n  label: Recipes\n---\n",
  "_content/recipes/Bread.recipe.card": marked("primary"),
})
=>
```

`_content/A` is `background`; `_content/A/B` has its OWN (non-background)
landmark; a `primary` card two levels down in `_content/A/B/C` is still
under `A`'s cascade even though the nearest landmark isn't the background
one.

```ts
await warningsFor({
  "_content/A/A.landmark.card": marked("background"),
  "_content/A/B/B.landmark.card": "---\nnavigation:\n  label: B\n---\n",
  "_content/A/B/C/Deep.memo.card": marked("primary"),
})
=> under-background-landmark: _content/A/B/C/Deep.memo.card: _content/A/B/C/Deep.memo.card is marked primary, but its landmark _content/A/A.landmark.card is marked prominence: background — a background place folds away everything under it
```

## `entry-point`/`primary` written on a landmark card itself

A landmark marks a place, not a visitable file — its own `prominence` is
either absent or `background`; writing `entry-point` or `primary` on it is a
misunderstanding of the field.

```ts
await warningsFor({ "_content/recipes/Recipes.landmark.card": marked("entry-point") })
=> landmark-prominence: _content/recipes/Recipes.landmark.card: a landmark marks a place; the place's entry point is a visitable card inside it
```

## `primary`/`entry-point` inside an OWNED attach scope has no effect

`Foo.attach/` is owned when a sibling card's basename is `Foo`. A prominence
mark inside it is invisible to every reader, since the scope is folded into
its owner.

```ts
await warningsFor({
  "_content/projects/Foo.memo.card": "---\ntitle: Foo\n---\n",
  "_content/projects/Foo.attach/Note.memo.card": marked("primary"),
})
=> inside-attach-scope: _content/projects/Foo.attach/Note.memo.card: prominence inside an attach scope has no effect; mark the owner card, or list it in the landmark's `links:`
```

An UNOWNED `.attach/`-suffixed directory (no sibling card named `Foo`) is not
a real attach scope for this rule's purposes — nothing to warn about.

```ts
await warningsFor({ "_content/projects/Foo.attach/Note.memo.card": marked("primary") })
=>
```

An owned attach scope that holds its OWN landmark is that landmark's home
(`prunedSubtree` walks it), so a mark inside it feeds the landmark's derived
list and is not warned about.

```ts
await warningsFor({
  "_content/courses/Foo.course.card": "---\ntitle: Foo\n---\n",
  "_content/courses/Foo.attach/Foo.landmark.card": "---\nnavigation:\n  label: Foo\n---\n",
  "_content/courses/Foo.attach/Plan.memo.card": marked("primary"),
})
=>
```

## A `background` root landmark

The root landmark lives directly in `_content/`. Marking it `background`
is the box's identity, not a place that can be housekeeping — the value is ignored and warned about.

```ts
await warningsFor({ "_content/Box.landmark.card": marked("background") })
=> background-root-landmark: _content/Box.landmark.card: the root landmark is marked prominence: background — the root is the box's identity, not a place that can be housekeeping, so the value is ignored; remove it
```

A landmark elsewhere in the tree marked `background` is an ordinary
housekeeping place, not the root — no root-specific warning.

```ts
await warningsFor({ "_content/logs/Logs.landmark.card": marked("background") })
=>
```

## A redundant `links:` entry — info, not a warning

The landmark links its own `Plan.memo.card`, which is already marked
`primary` and inside the landmark's pruned subtree, with no label: the
derived list already shows it, so the entry is redundant.

```ts
await warningsFor({
  "_content/proj/Proj.landmark.card":
    "---\nnavigation:\n  label: Proj\n  links:\n    - ref: /_content/proj/Plan.memo.card\n---\n",
  "_content/proj/Plan.memo.card": marked("primary"),
})
=> redundant-link: _content/proj/Proj.landmark.card: link to _content/proj/Plan.memo.card is redundant with the target's own prominence: primary — the derived list already surfaces it
```

A LABELED entry, or one pointing outside the landmark's pruned subtree
(a nested landmark's territory), is not flagged.

```ts
await warningsFor({
  "_content/proj/Proj.landmark.card":
    "---\nnavigation:\n  label: Proj\n  links:\n    - ref: /_content/proj/Plan.memo.card\n      label: the plan\n---\n",
  "_content/proj/Plan.memo.card": marked("primary"),
})
=>
```
