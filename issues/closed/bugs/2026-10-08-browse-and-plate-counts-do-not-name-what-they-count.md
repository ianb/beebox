---
title: "Browse, plate, and folder counts disagree and none says what it counts"
workstream: bug-burndown-5
resolution: implemented
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — A-lending, D-chemistry and F-newcomer journey walks, 2026-10-08
---

> **Closed 2026-10-27 (bug-burndown-5):** the 2026-10-22 reopen is fixed. The
> card, folder and list-row todo line now leads with the noun: "1 todo now ·
> 1 done", "3 todos now · 1 later" (`summaryParts`). "Plate" stays out of
> the wording, per the 2026-10-20 decision. The folder-count gap below remains
> by design. Test: `src/frontend/test/components/todo/summary.test.ts`.

**Reopened 2026-10-22:** a card's todo line again says only "1 now", with no noun; see the note at the end.

Closed 2026-10-16 (history) on worktree-plate-wording (8eaccd8ac, 61de22bd4): card, folder and list-row todo lines now split open todos as the plate does ("7 on your plate · 1 later · 2 overdue"); the nav badge hover says "overdue"; the Browse sidebar folder number keeps its bare number, and its hover and screen-reader label say "N cards, including subfolders". One gap remains by design: a folder's line skips todos in other cards that link into the folder (the reference pass reads the whole box; `docs/implemented-plans/todos-ui.md` defers it to a reverse index), so it can be one lower than the folder's list. Its hover text names the set.

Walkers saw numbers that looked wrong and could not tell which to trust. In
the A-lending walk the plate said 5, Browse said "6 open · 1 done", the
folder said "lending/ 8" and the chat folder "chat/ 2". In the D-chemistry
walk a folder said "Content, 3 items" with 13 entries inside. In the
F-newcomer walk the badge said 3 todos on the plate while the card said "4
open". Each number is correct for a different set. Reports:
[A-lending](../../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-08.md) (row 54),
[D-chemistry](../../../beebox/test/plugins/courseware/journeys/D-chemistry/reports/2026-10-08.md) (row 11),
[F-newcomer](../../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-08.md) (rows 22, 29).

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
set ([closed](2026-08-25-plate-badge-is-a-bare-number.md)).

## Re-encounter 2026-10-09 (journey walks)

Seen again in two walks. [C](../../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-09.md) (row 45): "Content/ 5" after the person made one thing; the walker asked "What are the other four?". The folder number counts every `.card` below it (`beebox/src/webapp/trpc/routers/status.ts:110-113`): the root landmark, the briefing, the plate view, the doc card and the chat card. [F](../../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-09.md) (row 27): "0 later" in the todo view; the walker asked "later than what?" (`todo-view/TodoViewControls.tsx`). The place page's own count is labelled ("Every loan card here 6", [A](../../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-09.md)).

## Reopened 2026-10-22 (A-lending journey walk): the card line lost its noun

The line under a card's title reads "1 now", "2 now", "4 now · 1 done". The [A-lending](../../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-22.md) walker (row 19): "There's a '1 now' under the title that I don't get (1 what? now?)." It learned the meaning only after it opened the Todos page.

The 2026-10-16 fix wrote "N on your plate" on the card line. `8bd8399d1` (2026-10-20, "the word 'plate' leaves everything a person or the agent reads") made "now" and "later" the state pair, and on the card line "now" is now the only word (`summaryParts`, `beebox/src/frontend/src/components/todo/summary.ts:44`). The same count has a noun in two other places: the root page says "N to do" (`rootLineParts`, same file) and the badge says "N todos now" (`beebox/src/frontend/src/components/app-bar-faces/AttentionBadgesFace.tsx:92-94`). A fix such as "1 todo now · 1 done" keeps the 2026-10-20 decision on "plate".

A related count on a new surface is filed separately: [the Box page count omits later todos](2026-10-22-box-page-to-do-count-omits-later-todos.md).
