---
title: "The Box page says \"1 to do\" when five more todos are dated for later"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — G-paperwork walk, 2026-10-22
resolution: implemented
---

Resolved 2026-10-22 by the journey-walks-late-oct fix commit. `NavCounts.laterTodos` added; the Box page reads "1 to do · 5 later".

The agent filed four papers with dated tasks. Then the Box page said "1 to do". The walker: "the card on the left says '1 to do' in the summary but I was told about several things (insurance, slip, car, ivy)."

The box had six open todos: one with no date (now) and five with a future `start` date (later). Three surfaces showed three counts for that set:

- Box page: "1 to do".
- Nav badge: "1 todo now".
- Todos page: "1 now · 5 later".

A person who has just handed over a pile of deadlines sees "1 to do" and can think that the box lost them.

Report: [G-paperwork](../../../beebox/test/user-stories/journeys/G-paperwork/reports/2026-10-22.md) (row 26).

## Mechanism

`rootLineParts` (`beebox/src/frontend/src/components/todo/summary.ts:60-75`) counts only `onPlateTodos` and `escalatedTodos` from the nav counts. It has no "later" part. Its comment records the choice to use the nav's counts so that the page and the badge agree. The card line (`summaryParts`, same file) does add "N later".

## Why the fix is not obvious

The nav counts do not carry a "later" number. Options: add a later count to `NavCounts` and to the root line; or word the line so that it says what it counts ("1 due now"). The badge and the page should still agree.

Related: [counts do not name what they count](2026-10-08-browse-and-plate-counts-do-not-name-what-they-count.md) (reopened 2026-10-22 for the card line), [a standing care hint becomes the only "now" todo](2026-10-22-standing-care-hint-becomes-the-only-now-todo.md) (the one "now" item in this walk).
