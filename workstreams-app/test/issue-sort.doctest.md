# Stable issue priority sorting

Priority sorting uses the persisted issue records. Pending edits affect the row
controls, but are deliberately absent from the sort input until save succeeds
and refreshes those records.

```ts setup
import { filterAndSortIssues } from "../src/frontend/components/IssuesPane.js";

const records = [
  { slug: "2026-08-24-newer-normal", frontmatter: { priority: "normal" as const } },
  { slug: "2026-08-23-important", frontmatter: { priority: "important" as const } },
  { slug: "2026-08-22-older-normal", frontmatter: { priority: "normal" as const } },
];
```

```ts
JSON.stringify({
  sorted: filterAndSortIssues(records, { sort: "priority" }).map((issue) => issue.slug),
  normal: filterAndSortIssues(records, { priority: "normal", sort: "priority" }).map((issue) => issue.slug),
})
=> {"sorted":["2026-08-23-important","2026-08-24-newer-normal","2026-08-22-older-normal"],"normal":["2026-08-24-newer-normal","2026-08-22-older-normal"]}
```
