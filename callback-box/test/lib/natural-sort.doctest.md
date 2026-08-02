# Natural sort

`naturalCompare` sorts strings the way a human reads file listings: numeric runs
compare by value, so `foo-2` comes before `foo-3` comes before `foo-20` — not the
lexical order (`foo-2`, `foo-20`, `foo-3`) that plain `localeCompare` produces.

```ts setup
import { naturalCompare } from "../../src/lib/natural-sort.js";
```

## Numeric suffixes sort by value, not lexically

```ts
const names = ["foo-3", "foo-20", "foo-2", "foo-1", "foo-10"];
t.check(JSON.stringify(names.slice().sort(naturalCompare)), JSON.stringify([
  "foo-1",
  "foo-2",
  "foo-3",
  "foo-10",
  "foo-20",
]));
```

## Non-numeric names still sort as before, and numbers embedded mid-name work

```ts
const mixed = ["b", "a10", "a2", "a1", "c"];
t.check(JSON.stringify(mixed.slice().sort(naturalCompare)), JSON.stringify([
  "a1",
  "a2",
  "a10",
  "b",
  "c",
]));
```
