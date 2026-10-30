---
title: "The finish-preflight sheet prints every selected test before the verification block"
workstream: unattached
area: bin
labels: [finish, tooling]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261019-230412
resolution: implemented
---

**Closed 2026-10-29 (tooling-burndown).** `formatSheet` now prints the merge
result, the verification block, and `skipTypecheckLint` right after the
worktree line. The selected tests come last: the count, a `by reason:` line
with the three largest reason groups from `bin/test-select.ts --json`, the
first five files, and a pointer to `--json` (every file) and
`bin/test-select.ts --why`. Test: `bin/finish-preflight.test.ts`.

`formatSheet` in `bin/finish-preflight.ts` writes one line per selected test
file, then the `verification:` block and `skipTypecheckLint`. On a large diff
the list runs to hundreds of lines. A finish agent that reads the head of the
output misses the verification block; one that pipes through `tail` misses the
merge result at the top.

Coding feedback: doctest-typecheck/20261019T002804Z-landed.md,
doctest-typecheck/20261018T161724Z-landed.md,
journey-courseware/20261018T023442Z-landed.md,
journey-courseware/20261017T235033Z-landed.md,
flaky-tests/20261019T130712Z-landed.md.

Direction: print the selected-test count and the first few files, with the full
list in `--json`, and put the verification block before it.

**2026-10-22 (retrospective 20261022-232146):** Two more finish runs hit it:
one re-ran preflight with `--no-merge` to a file after `tail` truncated it, and
one named the test list as noise beside the verification block. Coding
feedback: engine-link-migration-fix/20261022T134911Z-landed.md,
gmail-404-stuck/20261023T020419Z-landed.md.
