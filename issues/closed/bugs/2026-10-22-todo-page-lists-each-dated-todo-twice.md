---
title: "The Todos page lists each dated todo twice: in the Dated strip and again under its card"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — A-lending and G-paperwork walks, 2026-10-22
resolution: implemented
---

Resolved 2026-10-22 by the journey-walks-late-oct fix commit. Boxholder decision: the Dated strip became a "By date" tab; no todo is listed twice.

The Todos page shows each open dated todo two times. In the A-lending walk all four open todos had a date. The "Dated" strip listed the four todos. The "Lent and borrowed" block under it listed the same four again. In the G-paperwork walk the strip listed five todos, and each paper's block listed them again.

The walkers:

- A: "why the to-dos appear twice on the Todos screen"; the page is "a bit cluttered".
- G: "the list is half-duplicated (once as list, once per paper)", and "I'd have wanted 'By date' as the main view". The strip did not read as the date view.

Reports: [A-lending](../../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-22.md) (row 28), [G-paperwork](../../../beebox/test/user-stories/journeys/G-paperwork/reports/2026-10-22.md) (rows 30, 31).

## Mechanism

- `TodoViewCard` renders the Dated strip first, then one block per card (`beebox/src/frontend/src/components/TodoViewCard.tsx:86-104`).
- `datedTodos` takes every open, matching todo that has a `due` or a `start` (`beebox/src/frontend/src/components/todo-view-card-logic.ts:262-277`). The card blocks keep them.
- The plan asks for both parts (`beebox/docs/implemented-plans/todo-collection.md`). The strip's comment assumes that few todos have dates ("Most todos in a working box carry no date at all", `beebox/src/frontend/src/components/todo-view/DatedStrip.tsx`).

## Why the fix is not obvious

The strip answers "what is next by date". The card blocks answer "what belongs to what". When few todos have dates, the repeat is small. A lending list or a pile of paperwork has a date on most todos, and then the page repeats itself. Options: hide the strip when it would repeat most of the list; show dated todos only in the strip and mark their place in the card block; or make the date order a tab of its own. This needs a design choice.

Related: [collection views are badly defined](../../features/2026-08-19-collection-views-are-badly-defined.md), [dated strip does not mark overdue](2026-10-22-dated-strip-does-not-mark-overdue.md).
