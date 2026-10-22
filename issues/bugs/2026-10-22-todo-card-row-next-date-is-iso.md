---
title: "A Todos card row shows its next date as \"next 2026-10-26\""
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — F-newcomer and G-paperwork walks, 2026-10-22
---

A card row in the Todos view shows a badge "next 2026-10-26". The badge prints `reduction.next` as it is (`beebox/src/frontend/src/components/todo-view/CardRow/view.tsx:36-37`). The Dated strip above it shows the same date as "due Oct 26, 2026" through `FriendlyDate`. One screen shows one date in two forms.

In the G-paperwork walk the rows read "next 2026-10-24", "next 2026-10-31", "next 2026-11-16", and "next 2027-08-11". There "next" was a todo's `start` date, not its due date, so "next 2026-10-24" sat beside "due Nov 7". The badge's title, "Next date on this card", does not say which date it is.

Reports: [F-newcomer](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-22.md) (R3; shots 19-21), [G-paperwork](../../beebox/test/user-stories/journeys/G-paperwork/reports/2026-10-22.md) (R8).

## Fix direction

Render `reduction.next` with `FriendlyDate`. Say which kind of date it is ("starts Oct 24", "due Nov 7"), as the Dated strip does; that needs the kind next to the date in the reduction.
