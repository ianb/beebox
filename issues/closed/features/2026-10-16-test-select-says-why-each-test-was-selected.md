---
title: "test-select does not say which changed file selected each test"
workstream: unattached
area: bin
labels: [finish, testing]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261016-225122
design: ../../../beebox/docs/plans/change-based-test-selection.md
resolution: implemented
---

**Closed 2026-10-29 (tooling-burndown).** `selectTests` now returns
`reasons`: each selected test grouped by the changed path that reached it
(`imports <path>`, `spawns a child that runs <path>`) or a category (`the test
itself changed`, `graph cannot resolve its imports (always runs)`), largest
group first. `bin/test-select.ts --why` prints every group with its tests;
the list form adds a `by reason:` line with the three largest groups on
stderr; `--json` prints `{ files, reasons }`. On `--base HEAD~4` (760 files)
the line read `742 imports beebox/src/shared/agent-models.ts; 702 imports
beebox/src/shared/chat-models.ts; 618 imports beebox/src/lib/git/internal.ts;
147 more reasons`. Test: `bin/test-select.test.ts`.

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
the selection by reason, with the count for each: the changed path that reached
a test where one exists, and otherwise the category (for example, tests the
graph cannot resolve). Then a session can see that one import accounts for
most of the selection.
