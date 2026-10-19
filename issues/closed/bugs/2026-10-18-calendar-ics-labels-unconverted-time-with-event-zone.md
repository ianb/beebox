---
title: "A pulled calendar event can land at the wrong local time in its .ics file"
workstream: bug-burndown-3
area: connectors
priority: normal
labels: [connectors, google-calendar]
filed-by: agent
discovered-by: agent
discovered-in: doctest-typecheck — retire-doctest track 5, strengthening beebox/test/connectors/google-calendar.test.ts
resolution: implemented
---

`eventToIcs` writes a timed event's `DTSTART`/`DTEND` with the event's
`timeZone` as `TZID`, but takes the wall-clock digits straight from
`start.dateTime` without converting the instant to that zone:

- `beebox/src/connectors/google-calendar/ics.ts:17-30`, `parseLocalTimeParts`:
  "The time in the string IS the local time — we extract it directly without
  UTC conversion". The `Z` or `±hh:mm` suffix is ignored.
- `ics.ts:170-181`, `setDateTimeWithTz`: builds the time from those digits
  and sets `tzid` to `timeZone`.

That is right only when the offset in `dateTime` equals the offset of
`timeZone`. Two ways it differs in practice:

- After the box pushes an event, the remote copy holds a UTC instant
  (`ics.ts:355` pushes `toISOString()`), e.g. `16:00Z` with
  `timeZone: America/New_York`. The next pull writes
  `DTSTART;TZID=America/New_York:...T160000`: 4 hours late. The Lunch test in
  `beebox/test/connectors/google-calendar.test.ts` shows it; it pins only the
  `SUMMARY` line for that reason.
- `events.list` returns `dateTime` in the calendar's zone, not the event's.
  An event in America/New_York on a calendar in America/Los_Angeles comes back
  as `09:00-07:00` and is written as 09:00 New York time: 3 hours early.

Unverified against the live API; the diagnosis is from the code and the
API's documented `dateTime` format.

Fix direction: when `timeZone` is set, convert the instant
(`new Date(dateTime)`) to that zone's wall time (`Intl.DateTimeFormat` with
`timeZone`) before building the ICAL time; keep the digit slice only when no
zone is given. Then pin the Lunch test's `DTSTART`/`DTEND` (12:00 and 13:00
New York) and add a case whose offset differs from its zone.

## Resolution

2026-10-19, bug-burndown-3: `setDateTimeWithTz` in
`beebox/src/connectors/google-calendar/ics.ts` now converts a `dateTime` that
has a `Z` or `±hh:mm` suffix to its instant's wall time in `timeZone`
(`Intl.DateTimeFormat`, `hourCycle: "h23"`). A `dateTime` without a suffix
keeps its digits. All-day dates and events without `timeZone` are unchanged.
`beebox/test/connectors/google-calendar.test.ts` now pins the Lunch push
case's `DTSTART`/`DTEND` (12:00 and 13:00 New York) and adds a case with
`-07:00` and `Z` offsets on an America/New_York event.

Files already on disk are not corrected by this fix. The connector rewrites a
file only when Google returns its event again: on a remote change, or on a
full-window resync (a 410, or cleared sync tokens in the gitignored transient
state). A full resync rewrites every in-window event that has no local edit.
Events outside the sync window keep their old times.
