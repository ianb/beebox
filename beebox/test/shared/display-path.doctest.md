# Display Path Vocabulary

`toDisplayPath`/`fromDisplayPath` convert between the canonical box path form
(`/_content/...`, used by refs/URLs/storage) and the boxholder-facing display
form (BOXHOLDER-SETTLED, `docs/plans/one-root-box-layout.md`): a content path
displays bare with no leading slash; any other area displays as
`<AreaLabel>:path/inside`, with the label derived from the area name.

```ts setup
import { areaDisplayLabel, fromDisplayPath, toDisplayPath } from "../../src/shared/display-path.js";
```

## `toDisplayPath`

A content path displays bare, no leading slash:

```ts
toDisplayPath("/_content/recipes/Soup.recipe.card")
=> recipes/Soup.recipe.card

toDisplayPath("_content/recipes/Soup.recipe.card")
=> recipes/Soup.recipe.card
```

A non-content area displays as `<AreaLabel>:path/inside`:

```ts
toDisplayPath("/_config/box.json")
=> Config:box.json

toDisplayPath("/_bookkeeping/jobs/x.job.card")
=> Bookkeeping:jobs/x.job.card

toDisplayPath("/_publish/site/index.html")
=> Publish:site/index.html

toDisplayPath("/_tmp/scratch.txt")
=> Tmp:scratch.txt
```

The content root displays as the empty string; the box root displays as `/`:

```ts
JSON.stringify(toDisplayPath("/_content"))
=> ""

toDisplayPath("/")
=> /

JSON.stringify(toDisplayPath(""))
=> "/"
```

An unknown top-level segment (shouldn't exist in a valid box) passes through
unchanged:

```ts
toDisplayPath("/src/tricks/scripts/foo.ts")
=> /src/tricks/scripts/foo.ts
```

## `fromDisplayPath`

A bare or leading-slash path is content-relative:

```ts
fromDisplayPath("recipes/Soup.recipe.card")
=> /_content/recipes/Soup.recipe.card

fromDisplayPath("/recipes/Soup.recipe.card")
=> /_content/recipes/Soup.recipe.card
```

An area-label form (case-insensitive) maps to that area:

```ts
fromDisplayPath("Config:box.json")
=> /_config/box.json

fromDisplayPath("config:box.json")
=> /_config/box.json

fromDisplayPath("Bookkeeping:jobs/x.job.card")
=> /_bookkeeping/jobs/x.job.card

fromDisplayPath("Publish:site/index.html")
=> /_publish/site/index.html

fromDisplayPath("Tmp:scratch.txt")
=> /_tmp/scratch.txt
```

Raw canonical forms (already area-coded) pass through unchanged-to-canonical,
with or without a leading slash:

```ts
fromDisplayPath("/_config/box.json")
=> /_config/box.json

fromDisplayPath("_config/box.json")
=> /_config/box.json
```

The empty string and `/` both mean the box root:

```ts
fromDisplayPath("")
=> /

fromDisplayPath("/")
=> /
```

## Round trips

Every display form round-trips through its canonical form:

```ts continue
const cases = [
  "/_content/recipes/Soup.recipe.card",
  "/_config/box.json",
  "/_bookkeeping/jobs/x.job.card",
  "/_publish/site/index.html",
  "/_tmp/scratch.txt",
];
const roundTripped = cases.map((canonical) => fromDisplayPath(toDisplayPath(canonical)));
JSON.stringify(roundTripped, null, 2)
=> [
  "/_content/recipes/Soup.recipe.card",
  "/_config/box.json",
  "/_bookkeeping/jobs/x.job.card",
  "/_publish/site/index.html",
  "/_tmp/scratch.txt"
]
```

## `areaDisplayLabel`

Derived from the area name — strip the underscore, capitalize the first
letter:

```ts
areaDisplayLabel("_config")
=> Config

areaDisplayLabel("_bookkeeping")
=> Bookkeeping

areaDisplayLabel("_publish")
=> Publish

areaDisplayLabel("_tmp")
=> Tmp
```
