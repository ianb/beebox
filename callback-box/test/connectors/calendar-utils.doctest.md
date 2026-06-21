# Calendar Utilities

Parsing and formatting utilities for `.ics` calendar files. `parseIcsContent` extracts events from iCalendar data. `formatEvent` produces terminal-friendly display strings. `parseTimespan` converts shorthand like `"7d"` into milliseconds.

```ts setup
import { parseIcsContent, formatEvent, parseTimespan, filterByDateRange } from "../../src/connectors/calendar-utils.js";
```

## parseTimespan

Converts human-readable timespan strings into milliseconds. Supports `d` (days), `w` (weeks), `m` (months ≈ 30 days). Plain number defaults to days.

```ts
parseTimespan("7d")
=> 604800000

parseTimespan("2w")
=> 1209600000

parseTimespan("1m")
=> 2592000000

parseTimespan("3")
=> 259200000
```

## parseIcsContent

Parses a `.ics` string into `CalendarEvent` objects. A minimal event:

```ts setup
const simpleIcs = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:test-123
SUMMARY:Team Standup
DTSTART:20260315T100000Z
DTEND:20260315T103000Z
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`;
```

```ts
const events = parseIcsContent(simpleIcs, { filename: "test.ics" });
events.length
=> 1

events[0].summary
=> Team Standup

events[0].uid
=> test-123

events[0].allDay
=> false
```

All-day events have `DTSTART` as a date (no time component):

```ts setup
const allDayIcs = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:allday-1
SUMMARY:Company Holiday
DTSTART;VALUE=DATE:20260320
DTEND;VALUE=DATE:20260321
END:VEVENT
END:VCALENDAR`;
```

```ts
const ev = parseIcsContent(allDayIcs, { filename: "holiday.ics" })[0];
ev.allDay
=> true

ev.summary
=> Company Holiday
```

Cancelled events are filtered out:

```ts setup
const cancelledIcs = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:cancelled-1
SUMMARY:Cancelled Meeting
STATUS:CANCELLED
DTSTART:20260315T100000Z
DTEND:20260315T103000Z
END:VEVENT
END:VCALENDAR`;
```

```ts
parseIcsContent(cancelledIcs, { filename: "cancelled.ics" }).length
=> 0
```

Custom properties (`X-CB-*`) carry calendar metadata:

```ts setup
const metaIcs = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:meta-1
SUMMARY:School Play
DTSTART:20260320T190000Z
DTEND:20260320T210000Z
X-CB-CALENDAR-ID:school-cal
X-CB-CALENDAR-NAME:GRS School Calendar
X-CB-CALENDAR-ROLE:reader
END:VEVENT
END:VCALENDAR`;
```

```ts
const meta = parseIcsContent(metaIcs, { filename: "play.ics" })[0];
meta.calendarId
=> school-cal

meta.calendarName
=> GRS School Calendar

meta.calendarRole
=> reader
```

## formatEvent

Formats a `CalendarEvent` for terminal display. Owned calendar events show `[free]` only if transparent; subscribed calendar events show the calendar name in parens.

```ts setup
function makeEvent(overrides) {
  return {
    uid: "test",
    summary: "Meeting",
    start: new Date("2026-03-15T10:00:00Z"),
    end: new Date("2026-03-15T11:00:00Z"),
    allDay: false,
    status: "CONFIRMED",
    opaque: true,
    filename: "test.ics",
    ...overrides,
  };
}
```

A standard timed event (date and time are locale-dependent):

```ts
formatEvent(makeEvent({ summary: "Weekly Standup" }))
=> «*»  «*»  Weekly Standup
```

An all-day event:

```ts
formatEvent(makeEvent({ summary: "Dentist", allDay: true }))
=> «*»  all day       Dentist
```

A transparent (free) event on an owned calendar shows `[free]`:

```ts
formatEvent(makeEvent({ summary: "Lunch", opaque: false }))
=> «*»  «*»  Lunch  [free]
```

A subscribed calendar event shows the calendar name:

```ts
formatEvent(makeEvent({ summary: "School Play", calendarRole: "reader", calendarName: "GRS Calendar" }))
=> «*»  «*»  School Play  (GRS Calendar)
```

Events with location and description show tags:

```ts
formatEvent(makeEvent({ summary: "Offsite", location: "HQ", description: "Bring laptop" }))
=> «*»  «*»  Offsite  [loc, desc]
```

## filterByDateRange

Filters events to those overlapping a given date range:

```ts setup
const events = [
  makeEvent({ uid: "a", start: new Date("2026-03-14T10:00:00Z"), end: new Date("2026-03-14T11:00:00Z") }),
  makeEvent({ uid: "b", start: new Date("2026-03-15T10:00:00Z"), end: new Date("2026-03-15T11:00:00Z") }),
  makeEvent({ uid: "c", start: new Date("2026-03-16T10:00:00Z"), end: new Date("2026-03-16T11:00:00Z") }),
];
```

```ts
const filtered = filterByDateRange(events, {
  from: new Date("2026-03-15T00:00:00Z"),
  to: new Date("2026-03-16T00:00:00Z"),
});
filtered.length
=> 1

filtered[0].uid
=> b
```
