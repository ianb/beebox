---
title: "Date bugs found by the Temporal census: wrong day, hand-rolled zone math, date-only parsing"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-web-guidance-scan — Temporal census and the parked temporal-everywhere plan
---

The census for [temporal-everywhere](../../beebox/docs/unimplemented-plans/temporal-everywhere.md)
(parked 2026-11-12) found date handling that gives a wrong day or a wrong
time. The full conversion was declined. The boxholder's direction for fixes:
store UTC; use the box's timezone mostly for display, or explicitly where a
format carries a zone (for example `.ics`); no async polyfill.

Citations are from 2026-11-11; recheck before acting.

## A day computed in UTC or the server's zone where the box's day is meant

- `core/chat/husk.ts`: husk file names slice the UTC date
  (`date.toISOString().slice(0, 10)`).
- `core/procedure/engine/phase.ts`: the "Current date:" line in procedure
  prompts uses the UTC date.
- `core/box-backup/scheduled.ts`: "already backed up today" compares
  host-local `getFullYear/getMonth/getDate`.
- `cli/commands/calendar.ts`: day bounds from `setHours(0, 0, 0, 0)`
  (host-local).
- `core/usage.ts`, `core/pi-sessions.ts`: usage rows are bucketed by UTC day.
  This fits "store UTC", but `bbx usage` shows those buckets as days. A
  change to box days must also rebuild stored rows: unchanged session files
  are skipped (`usage.ts:274`, `:321`), so old and new rows would mix.

For a box in a US timezone each is off by a day for part of every evening.

## Hand-rolled zone arithmetic

- `connectors/google-calendar/ics.ts` computes zone offsets with three
  `Intl.DateTimeFormat` calls.
- `cli/commands/remind/time.ts` converts a zone-local wall time to UTC by a
  round trip through `Intl.DateTimeFormat` and `getUTC*`.

Both are the code most likely to be wrong across a DST change.

## All-day and date-only values

- ICS `VALUE=DATE` events (`connectors/google-calendar/utils.ts:130`) become
  UTC midnight; shown in a zone west of UTC they land on the previous day.
- `new Date("YYYY-MM-DD")` parses as UTC midnight: candidates
  `components/todo-view-card-logic.ts:284`, `connector-activity/core.ts`,
  `cli/commands/session/format.ts`.

## Related

- [Schedules ignore the box timezone](../features/2026-10-27-schedules-ignore-the-box-timezone.md)
- Box views: the views doc's "Dates" section and the `utc-today` and
  `date-string-parse` advice (box-view-guidance-and-checks plan) cover views.
  They currently recommend Temporal in views; that recommendation depends on
  the frontend polyfill, which loads asynchronously in `boot()`.
