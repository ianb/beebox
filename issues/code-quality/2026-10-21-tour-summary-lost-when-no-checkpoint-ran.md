---
title: "A tour that aborts before its first checkpoint loses its summary (ENOENT)"
workstream: tour-check
area: beebox
labels: [tours]
filed-by: agent
discovered-by: agent
discovered-in: worktree-tour-check — weekly tour check run 20261021-221418
---

`bin/tour card-theme-previews` printed only:

```
✗ ENOENT: no such file or directory, open '.../.artifacts/card-theme-previews/2026-10-22T03-45-58-782Z/summary.md'
```

Both passes aborted before any checkpoint, because the box lacks
`Theme_Tour.doc.card` ([fixture issue](../docs-and-chores/2026-09-23-test1-lacks-theme-tour-fixtures.md)).
Only `checkpoint.ts` creates the artifacts directory (`mkdir` at line 33).
`writeSummary` in `beebox/test/tours/tour-lib/summary.ts` then writes into a
directory that does not exist, so the findings that explain the abort are
lost. The reader sees a file-system error in place of "expected heading
\"Card themes tour\" not found".

## Possible resolution

Create `input.artifactsDir` in `writeSummary` before the write.
