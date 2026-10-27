---
title: "A scheduled script's RRULE without DTSTART is due on every tick of a matching day"
workstream: unattached
area: beebox
labels: [schedules, bug]
filed-by: agent
discovered-in: dep-reduction — rrule vs ical.js research, 2026-10-27
---

`isRruleDue` (`beebox/src/schemas/scheduled-script/due.ts:165-170`) parses the
card's string with `rrulestr` on every check:

```ts
const rule = rrulestr(rruleStr);
const after = ctx.lastRun ? new Date(ctx.lastRun) : new Date(0);
const occurrences = rule.between(after, ctx.now, false);
return occurrences.length > 0;
```

When the string has no `DTSTART`, rrule uses the parse time (now, truncated
to the second) as the start. On a day that matches the rule, the first
occurrence is therefore "now", which falls after `lastRun`, so the script is
due again on every scheduler tick. Reproduced 2026-10-27 with the real clock:
`FREQ=WEEKLY;BYDAY=TU` on a Tuesday, last run one minute earlier, gives
`between(lastRun, now)` = `[now]`.

`box-docs/card-scheduled-script.md` and `box-docs/bbx-commands.md` describe
`rrule` as an iCalendar RRULE with no mention of `DTSTART`, and the repo's
own examples (`FREQ=WEEKLY;BYDAY=MO`, `FREQ=WEEKLY;BYDAY=MO,FR`) have none.
No guard in `cli/tick-helpers.ts:159` limits a run to once per occurrence.

Possible fixes: require `DTSTART` in the schema; or give a DTSTART-less rule a
fixed start (for example the start of the day of `lastRun`, or the card's
creation time) so occurrences land on stable times. `health.ts:237-241`
(missed-occurrence scan) and `describe.ts:78` read the same strings and need
the same decision.
