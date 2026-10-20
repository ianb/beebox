---
title: "The finish-preflight sheet prints every selected test before the verification block"
workstream: unattached
area: bin
labels: [finish, tooling]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261019-230412
---

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
