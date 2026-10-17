---
title: "The layout check's unit-directory finding names only the directory move"
workstream: unattached
area: beebox
labels: [lint]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261016-225122
---

`beebox/src/dev/layout/check/rules/units.ts:135` tells the author to make a
unit directory and move the entry and its helpers in. Three sessions found
that the move was not the whole answer, or not the smallest one:

- `doctest-typecheck/20261016T124819Z-implemented.md`: a new module imported
  a helper directly and made existing files a unit. Importing through the
  existing entry fixed it. Asks that the message name that option.
- `theme-polish/20261016T064030Z-implemented.md`: the move also required
  renaming the mirrored tests, and a shared import had to stay outside the
  unit. Asks that the finding list the affected test names and say which
  modules are shared.
- `theme-polish/20261016T065133Z-landed.md`: the contract prose and the
  checker disagreed about the destination. Asks that the message cite the
  contract paragraph it enforces.

What would fix it: the finding names the importer that created the unit (so
importing through the entry is visible), the test files the move renames, and
the contract section. `docs-refresh-annex/20261016T142815Z-review-adjudicated.md`
found the message clear once read, so the change is to the detail, not the rule.
