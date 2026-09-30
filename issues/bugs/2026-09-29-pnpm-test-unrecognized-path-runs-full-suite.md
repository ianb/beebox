---
title: "`pnpm test <path>` runs the whole suite when it does not recognise the path"
workstream: unattached
area: dev-tooling
labels: [testing]
filed-by: agent
discovered-by: agent
discovered-in: worktree-doctest-usability — test subjects running one doctest
---

In `beebox/`, `pnpm test beebox/test/x.doctest.md` (a path relative to the
monorepo root, not the package) runs the entire suite. `tierCommand` in
`bin/test-tiers.ts` treats the argument as not an explicit file, keeps it, and
appends every file `.taprc` includes. Plain `pnpm exec tap` with the same path
refuses it: `No valid test files found matching …`.

On 2026-09-29, three test subjects in one worktree did this at once, trying to
run a single doctest. Three full suites ran in parallel for several minutes
before they were stopped.

An argument that looks like a test path (ends in `.doctest.md` or `.test.ts`)
but names no file should probably be refused, with a message naming the
package-relative path.
