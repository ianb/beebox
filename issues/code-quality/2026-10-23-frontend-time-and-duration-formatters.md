---
title: "Six \"x ago\" and five duration formatters in the frontend show the same time differently"
workstream: unattached
area: beebox
labels: [code-quality]
filed-by: agent
discovered-by: agent
discovered-in: worktree-dup-sweep-frontend — frontend pass of the functional-duplication sweep
---

Part of the [functional-duplication sweep](2026-10-22-functional-duplication-sweep.md).
`lib/relative-time.ts` (`formatAgo`, `formatElapsed`, tested) is the intended
home, but most views wrote their own.

## "x ago"

| Where | Under 1 min | Units | Rounding | Clock | After 7 days |
|---|---|---|---|---|---|
| `lib/relative-time.ts` formatAgo | just now (<45s) | min, hr, days | round | caller | days |
| `InteractiveChat/session-search.tsx:28` | just now | m, h, d | floor | real | days |
| `session-pickers/SessionRow.tsx:29` | just now | m, h, d | round | real | days |
| `HistoryViewCard/CommitTimeline.tsx:52` | just now | m, h, d | floor | box | locale date |
| `dashboard/RecentActivity.tsx:30`, `ScheduleOverview/view.tsx:32` | Ns ago | s, m, h, d | floor | box or real | days |

The two session pickers show the same chat sessions and can disagree by one
unit. None of the copies re-render with `useNow`, so captions go stale.

## Durations

`BackgroundTasks.tsx:32` (a local `formatElapsed`, same name as the lib export,
"3m05s"), `InteractiveChat-controls.tsx:33` ("3m 20s"), `ScheduleOverview/view.tsx:44`
`formatDurationMs` ("3m", no hours), `RecentActivity.tsx:114` (ms or "1.2s"). The
lib's `formatElapsed` gives "3 min".

## Absolute dates

`ui/FriendlyDate` is the tested rule, but about fourteen places call
`toLocaleString()` or `toLocaleTimeString()` directly (for example
`renderers/image.tsx:175`, `dashboard/SystemInfo.tsx:23`, `admin/InviteSection.tsx:98`)
and show "Invalid Date" on bad input. `Markdown/Source.tsx:173` `formatRetrieved`
re-solves FriendlyDate's date-only case.

## Decision needed

Which compact style is canonical (short or long units, seconds tier, rounding,
cut-over to a date)? Every merge changes visible text, so the sweep left them.
