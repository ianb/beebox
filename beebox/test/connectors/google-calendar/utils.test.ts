// # Calendar Utilities
//
// Parsing and formatting utilities for `.ics` calendar files. `parseIcsContent` extracts events from iCalendar data. `formatEvent` produces terminal-friendly display strings. `parseTimespan` converts shorthand like `"7d"` into milliseconds.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { parseIcsContent, formatEvent, parseTimespan, filterByDateRange, type CalendarEvent } from "../../../src/connectors/google-calendar/utils.js";

// ## parseIcsContent
//
// Parses a `.ics` string into `CalendarEvent` objects. A minimal event:
const simpleIcs = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:test-123
SUMMARY:Team Standup
DTSTART:20260315T100000Z
DTEND:20260315T103000Z
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`;

// All-day events have `DTSTART` as a date (no time component):
const allDayIcs = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:allday-1
SUMMARY:Company Holiday
DTSTART;VALUE=DATE:20260320
DTEND;VALUE=DATE:20260321
END:VEVENT
END:VCALENDAR`;

// Cancelled events are filtered out:
const cancelledIcs = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:cancelled-1
SUMMARY:Cancelled Meeting
STATUS:CANCELLED
DTSTART:20260315T100000Z
DTEND:20260315T103000Z
END:VEVENT
END:VCALENDAR`;

// Custom properties (`X-BBX-*`) carry calendar metadata:
const metaIcs = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:meta-1
SUMMARY:School Play
DTSTART:20260320T190000Z
DTEND:20260320T210000Z
X-BBX-CALENDAR-ID:school-cal
X-BBX-CALENDAR-NAME:GRS School Calendar
X-BBX-CALENDAR-ROLE:reader
END:VEVENT
END:VCALENDAR`;

// ## formatEvent
//
// Formats a `CalendarEvent` for terminal display. Owned calendar events show `[free]` only if transparent; subscribed calendar events show the calendar name in parens.
function makeEvent(overrides: Partial<CalendarEvent>): CalendarEvent {
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

// ## filterByDateRange
//
// Filters events to those overlapping a given date range:
const events = [
  makeEvent({ uid: "a", start: new Date("2026-03-14T10:00:00Z"), end: new Date("2026-03-14T11:00:00Z") }),
  makeEvent({ uid: "b", start: new Date("2026-03-15T10:00:00Z"), end: new Date("2026-03-15T11:00:00Z") }),
  makeEvent({ uid: "c", start: new Date("2026-03-16T10:00:00Z"), end: new Date("2026-03-16T11:00:00Z") }),
];

// ## parseTimespan
//
// Converts human-readable timespan strings into milliseconds. Supports `d` (days), `w` (weeks), `m` (months ≈ 30 days). Plain number defaults to days.
void test("Converts human-readable timespan strings into milliseconds.", async (t) => {
  t.check(parseTimespan("7d"), 604800000);

  t.check(parseTimespan("2w"), 1209600000);

  t.check(parseTimespan("1m"), 2592000000);

  t.check(parseTimespan("3"), 259200000);
});

void test("parseIcsContent", async (t) => {
  const parsed = parseIcsContent(simpleIcs, { filename: "test.ics" });
  t.check(parsed, [
    {
      uid: "test-123",
      summary: "Team Standup",
      start: new Date("2026-03-15T10:00:00Z"),
      end: new Date("2026-03-15T10:30:00Z"),
      allDay: false,
      status: "CONFIRMED",
      opaque: true,
      filename: "test.ics",
    },
  ]);
});

void test("parseIcsContent (line 71)", async (t) => {
  t.check(parseIcsContent(allDayIcs, { filename: "holiday.ics" }), [
    {
      uid: "allday-1",
      summary: "Company Holiday",
      start: new Date(2026, 2, 20),
      end: new Date(2026, 2, 21),
      allDay: true,
      status: "CONFIRMED",
      opaque: true,
      filename: "holiday.ics",
    },
  ]);
});

void test("parseIcsContent (line 94)", async (t) => {
  t.check(parseIcsContent(cancelledIcs, { filename: "cancelled.ics" }), []);
});

void test("parseIcsContent (line 115)", async (t) => {
  t.check(parseIcsContent(metaIcs, { filename: "play.ics" }), [
    {
      uid: "meta-1",
      summary: "School Play",
      start: new Date("2026-03-20T19:00:00Z"),
      end: new Date("2026-03-20T21:00:00Z"),
      allDay: false,
      status: "CONFIRMED",
      opaque: true,
      filename: "play.ics",
      calendarId: "school-cal",
      calendarName: "GRS School Calendar",
      calendarRole: "reader",
    },
  ]);
});

// A standard timed event (date and time are locale-dependent):
void test("A standard timed event (date and time are locale-dependent):", async (t) => {
  t.check(formatEvent(makeEvent({ summary: "Weekly Standup" })), str`${any(String)}  ${any(String)}  Weekly Standup`);
});

// An all-day event:
void test("An all-day event:", async (t) => {
  t.check(formatEvent(makeEvent({ summary: "Dentist", allDay: true })), str`${any(String)}  all day       Dentist`);
});

// A transparent (free) event on an owned calendar shows `[free]`:
void test("A transparent (free) event on an owned calendar shows [free]:", async (t) => {
  t.check(formatEvent(makeEvent({ summary: "Lunch", opaque: false })), str`${any(String)}  ${any(String)}  Lunch  [free]`);
});

// A subscribed calendar event shows the calendar name:
void test("A subscribed calendar event shows the calendar name:", async (t) => {
  t.check(formatEvent(makeEvent({ summary: "School Play", calendarRole: "reader", calendarName: "GRS Calendar" })), str`${any(String)}  ${any(String)}  School Play  (GRS Calendar)`);
});

// Events with location and description show tags:
void test("Events with location and description show tags:", async (t) => {
  t.check(formatEvent(makeEvent({ summary: "Offsite", location: "HQ", description: "Bring laptop" })), str`${any(String)}  ${any(String)}  Offsite  [loc, desc]`);
});

void test("filterByDateRange", async (t) => {
  const filtered = filterByDateRange(events, {
    from: new Date("2026-03-15T00:00:00Z"),
    to: new Date("2026-03-16T00:00:00Z"),
  });
  t.check(filtered, [
    {
      uid: "b",
      summary: "Meeting",
      start: new Date("2026-03-15T10:00:00Z"),
      end: new Date("2026-03-15T11:00:00Z"),
      allDay: false,
      status: "CONFIRMED",
      opaque: true,
      filename: "test.ics",
    },
  ]);
});

// ## A long-running daily series still shows its upcoming days
//
// Occurrences before the range are walked past, not counted toward the result
// limit. A daily series begun in 2024 is past its 500th occurrence by
// mid-2025, and used to expand to nothing for a later window.
void test("a daily series that began years before the range still expands inside it", (t) => {
  const daily = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:daily-1
SUMMARY:Morning walk
DTSTART:20240101T140000Z
DTEND:20240101T143000Z
RRULE:FREQ=DAILY
END:VEVENT
END:VCALENDAR`;
  const parsed = parseIcsContent(daily, {
    filename: "walk.ics",
    range: { from: new Date("2026-11-02T00:00:00Z"), to: new Date("2026-11-04T00:00:00Z") },
  });
  t.check(parsed.map((e) => e.start.toISOString()), ["2026-11-02T14:00:00.000Z", "2026-11-03T14:00:00.000Z"]);
  t.end();
});
