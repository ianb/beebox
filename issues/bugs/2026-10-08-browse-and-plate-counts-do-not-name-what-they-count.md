---
title: "Browse, plate, and folder counts disagree and none says what it counts"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — A-lending, D-chemistry and F-newcomer journey walks, 2026-10-08
---

Walkers saw numbers that looked wrong and could not tell which to trust. In
the A-lending walk the plate said 5, Browse said "6 open · 1 done", the
folder said "lending/ 8" and the chat folder "chat/ 2". In the D-chemistry
walk a folder said "Content, 3 items" with 13 entries inside. In the
F-newcomer walk the badge said 3 todos on the plate while the card said "4
open". Each number is correct for a different set. Reports:
[A-lending](../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-08.md) (row 54),
[D-chemistry](../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-08.md) (row 11),
[F-newcomer](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-08.md) (rows 22, 29).

## Mechanism

- Browse counts every open todo in the subtree, including todos that start
  later (`beebox/src/frontend/src/components/todo/DirectoryTodos.tsx:24-29`).
- The plate counts on-plate and escalated todos
  (`beebox/src/frontend/src/components/todo-view-card-logic.ts:197-199`,
  `plateHeadline`). The badge uses the same set
  (`beebox/src/frontend/src/components/AppNav/app-nav-badges.tsx:96-97`).
- The folder number counts every `.card` file below the folder, recursively,
  including landmark and briefing cards
  (`beebox/src/webapp/trpc/routers/status.ts:110-113`).
- The plate says "2 on your plate · 1 later"
  (`beebox/src/frontend/src/components/todo-view/TodoViewControls.tsx:112-115`), which explains the gap, but only on that
  screen.

## Fix direction

Name the unit where the number shows ("5 cards", "4 open todos, 1 later"),
or make the folder count agree with what the listing shows (the D-chemistry
listing showed 10 folders and 3 cards). The badge tooltip already names its
set ([closed](../closed/bugs/2026-08-25-plate-badge-is-a-bare-number.md)).

## Re-encounter 2026-10-09 (journey walks)

Seen again in two walks. [C](../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-09.md) (row 45): "Content/ 5" after the person made one thing; the walker asked "What are the other four?". The folder number counts every `.card` below it (`beebox/src/webapp/trpc/routers/status.ts:110-113`): the root landmark, the briefing, the plate view, the doc card and the chat card. [F](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-09.md) (row 27): "0 later" in the todo view; the walker asked "later than what?" (`todo-view/TodoViewControls.tsx`). The place page's own count is labelled ("Every loan card here 6", [A](../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-09.md)).
