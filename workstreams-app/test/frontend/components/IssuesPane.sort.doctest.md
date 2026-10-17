# Stable issue priority sorting

Priority sorting uses the persisted issue records. Pending edits affect the row
controls, but are deliberately absent from the sort input until save succeeds
and refreshes those records.

```ts setup
import { filterAndSortIssues } from "../../../src/frontend/components/IssuesPane/panel.js";

const records = [
  { slug: "2026-08-24-newer-normal", frontmatter: { priority: "normal" as const, workstream: "alpha" } },
  { slug: "2026-08-23-important", frontmatter: { priority: "important" as const, workstream: "beta" } },
  { slug: "2026-08-22-older-normal", frontmatter: { priority: "normal" as const, workstream: "alpha" } },
];
```

```ts
JSON.stringify({
  sorted: filterAndSortIssues(records, { sort: "priority" }).map((issue) => issue.slug),
  normal: filterAndSortIssues(records, { priority: "normal", sort: "priority" }).map((issue) => issue.slug),
  beta: filterAndSortIssues(records, { workstream: "beta" }).map((issue) => issue.slug),
  alphaImportant: filterAndSortIssues(records, { workstream: "alpha", priority: "important" }).map((issue) => issue.slug),
})
=> {"sorted":["2026-08-23-important","2026-08-24-newer-normal","2026-08-22-older-normal"],"normal":["2026-08-24-newer-normal","2026-08-22-older-normal"],"beta":["2026-08-23-important"],"alphaImportant":[]}
```
