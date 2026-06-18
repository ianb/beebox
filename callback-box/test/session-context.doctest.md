# Session Context

`src/core/session-context.ts` computes the situational attributes the
server stamps into the per-turn `<chat-app>` snapshot: a human-oriented
`local-time` (named weekday + phase of day in the box timezone) on every
message, plus `last-activity` and `calendar` on the first message of a
brand-new session. See `test/chat-features.doctest.md` for how the
attributes serialize into the tag.

```ts setup
import {
  buildSnapshotContext,
  describeElapsed,
  formatLocalTime,
  summarizeEvents,
} from "../src/core/session-context.js";
import type { CalendarEvent } from "../src/connectors/calendar-utils.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";

// The invalid-timezone example exercises the warn-and-fall-back path;
// silence the documented console.warn so it doesn't pollute test output.
console.warn = () => {};
```

## formatLocalTime

Renders a moment in the given IANA timezone with the named weekday, the zone
abbreviation, and a phase-of-day label — the three things models misderive
from a UTC ISO timestamp.

```
formatLocalTime(new Date("2026-06-09T19:32:00Z"), { timezone: "America/Chicago" })
=> Tuesday 2026-06-09 14:32 CDT (afternoon)

formatLocalTime(new Date("2026-06-09T19:32:00Z"), { timezone: "UTC" })
=> Tuesday 2026-06-09 19:32 UTC (evening)

formatLocalTime(new Date("2026-06-09T11:00:00Z"), { timezone: "America/Chicago" })
=> Tuesday 2026-06-09 06:00 CDT (morning)
```

The local date can differ from the UTC date — late evening in Chicago is
already the next day in UTC. The weekday and date follow the local zone.

```
formatLocalTime(new Date("2026-06-10T03:30:00Z"), { timezone: "America/Chicago" })
=> Tuesday 2026-06-09 22:30 CDT (late night)
```

An unusable timezone falls back to server-local time (with a console
warning) rather than failing — a bad config value must not break sends.
The output shape is the same; we just can't assert the zone-dependent
values here.

```
formatLocalTime(new Date("2026-06-09T19:32:00Z"), { timezone: "Not/AZone" })
=> «*» 2026-«*» («*»)
```

## describeElapsed

Coarse human durations for the `last-activity` attribute.

```
describeElapsed(30_000)
=> moments

describeElapsed(60_000)
=> 1 minute

describeElapsed(45 * 60_000)
=> 45 minutes

describeElapsed(5 * 3_600_000)
=> 5 hours

describeElapsed(3 * 86_400_000)
=> 3 days

describeElapsed(21 * 86_400_000)
=> 3 weeks
```

## summarizeEvents

One-line calendar summary. Events on the same local day as `now` show
bare times; later days get a short weekday prefix; all-day events say so.

```ts setup
function ev(summary: string, startIso: string, endIso: string): CalendarEvent {
  return {
    uid: summary,
    summary,
    start: new Date(startIso),
    end: new Date(endIso),
    allDay: false,
    status: "CONFIRMED",
    opaque: true,
    filename: `${summary}.ics`,
  };
}
const now = new Date("2026-06-09T10:00:00Z");
const tz = { timezone: "UTC", now };
```

```
summarizeEvents([
  ev("Dentist", "2026-06-09T16:00:00Z", "2026-06-09T17:00:00Z"),
  ev("Standup", "2026-06-10T09:00:00Z", "2026-06-10T09:30:00Z"),
], tz)
=> 16:00-17:00 Dentist; Wed 09:00-09:30 Standup

summarizeEvents([
  { ...ev("Field Day", "2026-06-09T00:00:00Z", "2026-06-10T00:00:00Z"), allDay: true },
], tz)
=> all day: Field Day
```

Cancelled events are skipped; an empty (or all-cancelled) list summarizes
to null.

```
summarizeEvents([
  { ...ev("Old Mtg", "2026-06-09T12:00:00Z", "2026-06-09T13:00:00Z"), status: "CANCELLED" },
], tz)
=> null

summarizeEvents([], tz)
=> null
```

Output is capped at four events with an overflow count, so a packed day
doesn't balloon the snapshot.

```
const six = ["A", "B", "C", "D", "E", "F"].map((s, i) =>
  ev(s, `2026-06-09T1${i}:00:00Z`, `2026-06-09T1${i}:30:00Z`));
summarizeEvents(six, tz)
=> 10:00-10:30 A; 11:00-11:30 B; 12:00-12:30 C; 13:00-13:30 D; +2 more
```

## buildSnapshotContext

The per-send entry point. `localTime` is always present; the
session-start extras only when `sessionStart` is true. A mid-session
send computes only the local time, and a session-start send on a
pristine box (no prior activity, no calendar) degrades to the same —
the extras are omitted, never empty strings.

```
const box = await makeTmpBox();
await box.write("config/box.json", JSON.stringify({ timezone: "UTC" }));
const sendNow = new Date("2026-06-09T10:00:00Z");

JSON.stringify(await buildSnapshotContext(box.root, { now: sendNow, sessionStart: false }))
=> {"localTime":"Tuesday 2026-06-09 10:00 UTC (morning)"}

JSON.stringify(await buildSnapshotContext(box.root, { now: sendNow, sessionStart: true }))
=> {"localTime":"Tuesday 2026-06-09 10:00 UTC (morning)"}
```

With a most-active pointer (written whenever any chat session on the box
sees activity) and a synced calendar, the session-start extras appear.

```continue
await box.write(".callback-box/chat-session-id.json", JSON.stringify({
  sessionId: "prev-session",
  savedAt: "2026-06-06T10:00:00Z",
}));
await box.write("store/calendar/dentist.ics", `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:dentist-1
SUMMARY:Dentist
DTSTART:20260609T160000Z
DTEND:20260609T170000Z
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`);

JSON.stringify(await buildSnapshotContext(box.root, { now: sendNow, sessionStart: true }), null, 2)
=> {
  "localTime": "Tuesday 2026-06-09 10:00 UTC (morning)",
  "lastActivity": "3 days ago",
  "calendar": "16:00-17:00 Dentist"
}
```

Events outside the 24-hour horizon don't surface — the attribute is
about imminent commitments, not the whole calendar.

```continue
await box.write("store/calendar/later.ics", `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:later-1
SUMMARY:Next Week Review
DTSTART:20260616T160000Z
DTEND:20260616T170000Z
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`);

(await buildSnapshotContext(box.root, { now: sendNow, sessionStart: true })).calendar
=> 16:00-17:00 Dentist
```

The `health` extra speaks only when a scheduled task is unhealthy —
a healthy box (like everything above) omits it entirely.

```continue
await box.write("config/schedules/sync-notes.scheduled-script.card", `---
cron: "0 * * * *"
runs: cb wakeup --connector notes
---
`);
await box.write("config/schedules/.state/sync-notes.json", JSON.stringify({
  lastRun: "2026-06-09T09:00:00Z",
  lastResult: "failure",
  lastError: "ENETUNREACH",
  lastSuccess: "2026-06-07T09:00:00Z",
  consecutiveFailures: 4,
  runCount: 50,
}));

(await buildSnapshotContext(box.root, { now: sendNow, sessionStart: true })).health
=> sync-notes: failing ×4 (last success 2d ago)

(await buildSnapshotContext(box.root, { now: sendNow, sessionStart: false })).health
=> undefined
```

```cleanup
await box.cleanup();
```
