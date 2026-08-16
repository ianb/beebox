# Issue category navigation

The category at or immediately before the sticky navigation offset is active.
Before the first section reaches that offset, the first category remains active.

```ts setup
import { activeCategoryAtOffset, issueCategoryId } from "../src/frontend/lib/issue-category-nav.js";

const categories = [
  { name: "features", top: 48 },
  { name: "bugs", top: 640 },
  { name: "decisions", top: 980 },
];
```

```ts
activeCategoryAtOffset(categories, { offset: 0, atEnd: false })
=> features
```

```ts
activeCategoryAtOffset(categories, { offset: 700, atEnd: false })
=> bugs
```

```ts
activeCategoryAtOffset(categories, { offset: 1200, atEnd: false })
=> decisions
```

```ts
activeCategoryAtOffset(categories, { offset: 700, atEnd: true })
=> decisions
```

```ts
issueCategoryId("docs & chores")
=> issue-category-docs%20%26%20chores
```
