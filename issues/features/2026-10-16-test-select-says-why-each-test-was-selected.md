---
title: "test-select does not say which changed file selected each test"
workstream: unattached
area: bin
labels: [finish, testing]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261016-225122
design: ../../beebox/docs/plans/change-based-test-selection.md
---

`bin/test-select.ts` prints the selected test paths and a size estimate. It
does not print which changed path pulled each test in. A change to one widely
imported file (a theme catalog, an app-wide stylesheet import, a git helper)
selects 547–581 tests. The session then cannot tell the few tests that exercise
the change from the tests that only import it, and narrows the rerun by hand.

Evidence from CODING_FEEDBACK, 2026-10-15 to 2026-10-16:

- `theme-polish/20261016T233617Z-implemented.md` and
  `theme-polish/20261016T234003Z-landed.md`: 581 tests from a shared catalog
  import; asks for a selector that reports dependency reasons.
- `theme-polish/20261016T221333Z-landed.md`: 581 selected, 76 relevant;
  stylesheet imports fan out.
- `trick-scoped-commit/20261016T034758Z-landed.md`: a git-helper change
  selected the frontend suite; asks for a narrower selection.
- `background-provider/20261015T232814Z-landed.md`: a 547-test list buried
  the sheet's decision fields.

What would fix it: a `--why` mode (or a summary in the first line) that groups
the selection by the changed path that reached it, with the count for each.
Then a session can see that one import accounts for most of the selection.
