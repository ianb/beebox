---
title: "The Todos Dated strip shows overdue and future items with the same chip"
workstream: unattached
area: beebox
labels: [todos]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — H-handover walk, 2026-10-22
---

The root page said "8 to do · 4 overdue". "4 overdue" opens the whole todo list, the same destination as "8 to do" (`beebox/src/frontend/src/components/PlaceView/view.tsx:106-107`). At the top of that list, the Dated strip showed "due Oct 2, 2026" (overdue) and "due Nov 30, 2026" (not due yet) in the same warning chip: `DatedLine` gives every due date `tone="warning"` (`beebox/src/frontend/src/components/todo-view/DatedStrip.tsx:35`). The per-card rows lower down do say "overdue · Oct 15" (shot 20).

The H-handover walker came to find what had slipped. She found the four late items by reading each date against today. The list answered her question ("exactly my question"), but nothing on it said which four were late.

Report: [H-handover](../../beebox/test/user-stories/journeys/H-handover/reports/2026-10-22.md) (rows 4, 5; shots 02, 03, 20).

## Why the fix is not obvious

The todo view has an Overdue group under "By status", but the Dated strip sits above both tabs. Options: an overdue tone or word in `DatedLine`; or "N overdue" opens the list on "By status". Related: [the Todos page lists each dated todo twice](2026-10-22-todo-page-lists-each-dated-todo-twice.md), [By date tab groups by state](../closed/bugs/2026-10-08-plate-by-date-tab-groups-by-state.md) (closed).
