---
title: "`serveSite` no longer rebuilds when a source changes or is deleted — two router tests fail"
workstream: unattached
area: router
filed-by: agent
discovered-by: agent
discovered-in: worktree-openrouter-services — running the router test suite after merging main on 2026-09-10
labels: [router, tests]
---

`workstreams-app/test/router/router-site.test.ts` has two failing cases on
current `main` (as merged into this worktree on 2026-09-10):

- *serveSite: a changed source (same set) triggers a rebuild* — expected one
  rebuild after editing `content/index.md`, got zero.
- *serveSite: a deleted source triggers a rebuild (content-based, not mtime)* —
  expected one rebuild after removing a source, got zero.

The other ten cases in the file pass, including "missing dist auto-builds" and
"missing manifest is treated as stale", so the build runner is wired and the
manifest is read; what has stopped is the **content-hash comparison** deciding
that a changed or shrunken source set differs from the built manifest. Either
the hash now ignores content (mtime-only, which the second test name says it
must not be), or the manifest written by a fresh build already reflects the
edit before the comparison runs.

Not touched by the workstream that noticed it — its `workstreams-app/` diff is
`router-worktree-start.ts`, `router-worktree-teardown.ts`, and
`router-core.test.ts` only. Reproduce with
`cd workstreams-app && node --import tsx --test test/router/router-site.test.ts`.
