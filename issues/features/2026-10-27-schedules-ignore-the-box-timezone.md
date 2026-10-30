---
title: "Scheduled scripts ignore the box timezone"
workstream: unattached
area: beebox
labels: [schedules, timezone]
filed-by: agent
discovered-in: dep-reduction — rrule DTSTART fix, 2026-10-27
---

A box can set an IANA `timezone` in `_config/box.json` (`loadBoxTimezone`,
`beebox/src/core/box/config.ts:184`); agent prompts and todos use it. The
scheduler does not:

- `isCronDue` (`beebox/src/schemas/scheduled-script/due.ts:144-148`) calls
  `CronExpressionParser.parse(cronExpr, { currentDate })` with no `tz`, so a
  cron runs in the host's zone. The production server is UTC
  (`timedatectl`: `Etc/UTC`, checked 2026-10-27), so ai-class (the one server
  box with a timezone, America/Chicago) runs `0 6 * * *` at 06:00 UTC, which
  is 01:00 in Chicago. `health.ts:280` (missed-occurrence scan) does the same.
- An `rrule` is evaluated in UTC. The guidance (`schemas/scheduled-script/instructions.ts`)
  now tells agents to write `DTSTART` in UTC, converted from the box
  timezone, and `bbx validate` warns when it is missing. A UTC start does not
  follow daylight saving: 09:00 Chicago is 14:00Z in summer and 15:00Z in
  winter, so the run moves an hour twice a year.

To decide: evaluate cron and rrule in the box timezone when one is set
(cron: `tz` option; rrule: `DTSTART;TZID=`, whose results rrule returns as
wall-clock times in a UTC `Date` and which need converting back), keeping UTC
for boxes without one. Adopting it shifts ai-class's existing cron schedules
to Chicago time, so tell the boxholder before it ships. The guidance and the
DTSTART warning (`core/card-lint/core/rrule-dtstart.ts`) change with it.
