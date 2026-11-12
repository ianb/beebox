---
title: "A box with tens of thousands of files needs features that do not walk the whole box"
workstream: unattached
area: beebox
labels: [performance, memory, scale]
filed-by: agent
discovered-by: Ian
discovered-in: "main session — production box crash loop, 2026-11-01"
---

A production box grew to about 20,000 files in one day when its agent
archived several large document sets (thousands of files in about 1,700
folders). Its engine then ran out of JavaScript heap (about 560 MB) seconds to
minutes after each start, and restarted in a loop. A heap profile put most of
the heap inside a `glob` walk of the whole box from
`listScopedCardPaths(boxRoot, "**/*.card")`, run by the nav's plate count on
every page and again after each burst of file changes. Overlapping walks were
the immediate cause, and nav counts now run one at a time per box
(`src/core/nav-counts.ts`). The cost of each walk still grows with every file
in the box.

The boxholder's suggestion: a "this box has a lot of files" state that changes
a few features. Candidates found so far:

- **Plate count and todo queries** (`src/core/todo/count.ts`,
  `src/core/collection/run/core.ts`): a box-wide `**/*.card` glob per
  request. The `glob` package keeps an object for every entry it visits,
  card or not. A pruned walk that keeps only `.card` paths would use less
  memory. A cached card index updated by the file watcher would avoid the
  walk entirely.
- **The file watcher** already logs "directory watch limit of 1,024 reached"
  and stops live updates below the deepest archive folders.
- Other box-wide walks: `listBoxCardFiles`, `listBoxMarkdownFiles`
  (`src/core/list-cards.ts`), validation, doc-graph, and search indexing.

Questions to settle: whether this is a flag at all, or whether the walks
should simply stop scaling with non-card files (archives of plain files, for
example, could be skipped by a marker or a path rule); where the threshold
comes from; and what a person sees when a feature degrades.
