---
title: "The plate's \"By date\" tab groups by plate state and shows no dates"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — A-lending, C-reconnecting and F-newcomer journey walks, 2026-10-08
---

The plate has two grouping tabs, "By place" and "By date". "By date" does not
group by date. It groups by plate state (Escalated, On the plate, Quiet,
Parked, Done, Dropped). When every todo is in one state, the tab shows one
group, "On the plate (4)", with no dates, and looks the same as "By place".
Reports: [A-lending](../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-08.md) (row 56),
[C-reconnecting](../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-08.md) (row 30),
[F-newcomer](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-08.md) (row 32: "DATED, ON THE
PLATE (2), QUIET (1)").

## Mechanism

- The tab sets grouping `plate`
  (`beebox/src/frontend/src/components/todo-view/TodoViewControls.tsx:80-81`).
- `plateGroup` in `beebox/src/core/todo/collection.ts:70-85` maps each todo to
  its `plateState`.
- The DATED strip renders above both tabs
  (`beebox/src/frontend/src/components/todo-view/DatedStrip.tsx:45-49`), so the
  only date display does not depend on the tab.

## Fix direction

Either rename the tab to what it does ("By status") or make it group by due
or start date. The grouping value `plate` is the internal name; the label is
the only user-visible part.

## Re-encounter 2026-10-09 (journey walks)

Seen again in [F](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-09.md) (row 58): "By date" does not sort by date; the walker saw DATED, then ON THE PLATE (3), the same grouped list with a relabelled header (shot 21).
