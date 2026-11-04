---
title: "Tests that spawn a child process have no shared helper for 'wait for its first line' or 'drop its pipes like a dying parent'"
workstream: unattached
area: beebox
labels: [testing]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261103-231838
---

Two sessions in one workstream hit the same gap in `beebox/test/helpers/`,
which has per-case child scripts (`file-lock-child.ts`,
`box-git-lock-child.ts`, ...) but no shared spawn helper:

- A lock test hung 30 s: by the session's report, the stdout iteration it
  used yielded bytes, so a string comparison against the first line never
  matched.
  (`docling-memory/20261104T044651Z-implemented.md`)
- An orphan test passed while the code had a BrokenPipe defect, because the
  test kept the child's stderr reader alive; a dying parent drops its pipes.
  Review found it. (`docling-memory/20261104T045552Z-review-adjudicated.md`)

Asked for: a helper that spawns a child and resolves on its first stdout
line as a string, and one that spawns a child and then closes every pipe the
way a dying parent does, so orphan tests exercise the real case by default.
