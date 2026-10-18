// # Calendar Utilities
//
// Parsing and formatting utilities for `.ics` calendar files. `parseIcsContent` extracts events from iCalendar data. `formatEvent` produces terminal-friendly display strings. `parseTimespan` converts shorthand like `"7d"` into milliseconds.

import { test } from "tap";
import "agent-doctest/tap";
import { any, str } from "agent-doctest/check";
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
  // doctest:L14
  t.check(parseTimespan("7d"), 604800000);

  // doctest:L17
  t.check(parseTimespan("2w"), 1209600000);

  // doctest:L20
  t.check(parseTimespan("1m"), 2592000000);

  // doctest:L23
  t.check(parseTimespan("3"), 259200000);
});

void test("parseIcsContent", async (t) => {
  // doctest:L44
  const parsed = parseIcsContent(simpleIcs, { filename: "test.ics" });
  await t.checkText(parsed.length, "1");

  // doctest:L48
  t.check(parsed[0]?.summary, "Team Standup");

  // doctest:L51
  t.check(parsed[0]?.uid, "test-123");

  // doctest:L54
  t.check(parsed[0]?.allDay, false);
});

void test("parseIcsContent (line 71)", async (t) => {
  // doctest:L72
  const ev = parseIcsContent(allDayIcs, { filename: "holiday.ics" })[0];
  t.check(ev?.allDay, true);

  // doctest:L76
  t.check(ev?.summary, "Company Holiday");
});

void test("parseIcsContent (line 94)", async (t) => {
  // doctest:L95
  await t.checkText(parseIcsContent(cancelledIcs, { filename: "cancelled.ics" }).length, "0");
});

void test("parseIcsContent (line 115)", async (t) => {
  // doctest:L116
  const meta = parseIcsContent(metaIcs, { filename: "play.ics" })[0];
  t.check(meta?.calendarId, "school-cal");

  // doctest:L120
  t.check(meta?.calendarName, "GRS School Calendar");

  // doctest:L123
  t.check(meta?.calendarRole, "reader");
});

// A standard timed event (date and time are locale-dependent):
void test("A standard timed event (date and time are locale-dependent):", async (t) => {
  // doctest:L150
  t.check(formatEvent(makeEvent({ summary: "Weekly Standup" })), str`${any(String)}  ${any(String)}  Weekly Standup`);
});

// An all-day event:
void test("An all-day event:", async (t) => {
  // doctest:L157
  t.check(formatEvent(makeEvent({ summary: "Dentist", allDay: true })), str`${any(String)}  all day       Dentist`);
});

// A transparent (free) event on an owned calendar shows `[free]`:
void test("A transparent (free) event on an owned calendar shows [free]:", async (t) => {
  // doctest:L164
  t.check(formatEvent(makeEvent({ summary: "Lunch", opaque: false })), str`${any(String)}  ${any(String)}  Lunch  [free]`);
});

// A subscribed calendar event shows the calendar name:
void test("A subscribed calendar event shows the calendar name:", async (t) => {
  // doctest:L171
  t.check(formatEvent(makeEvent({ summary: "School Play", calendarRole: "reader", calendarName: "GRS Calendar" })), str`${any(String)}  ${any(String)}  School Play  (GRS Calendar)`);
});

// Events with location and description show tags:
void test("Events with location and description show tags:", async (t) => {
  // doctest:L178
  t.check(formatEvent(makeEvent({ summary: "Offsite", location: "HQ", description: "Bring laptop" })), str`${any(String)}  ${any(String)}  Offsite  [loc, desc]`);
});

void test("filterByDateRange", async (t) => {
  // doctest:L195
  const filtered = filterByDateRange(events, {
    from: new Date("2026-03-15T00:00:00Z"),
    to: new Date("2026-03-16T00:00:00Z"),
  });
  await t.checkText(filtered.length, "1");

  // doctest:L202
  t.check(filtered[0]?.uid, "b");
});
