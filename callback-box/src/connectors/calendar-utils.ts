/**
 * Calendar utilities — parse .ics files and query events.
 *
 * Reads from local store/calendar/*.ics files. No API calls.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import ICAL from "ical.js";

export interface CalendarEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  allDay: boolean;
  status: string;
  filename: string;
}

/**
 * Parse a single .ics file into a CalendarEvent.
 */
export function parseIcsContent(
  content: string,
  filename: string
): CalendarEvent | null {
  try {
    const parsed = ICAL.parse(content);
    const comp = new ICAL.Component(parsed);
    const vevent = comp.getFirstSubcomponent("vevent");
    if (!vevent) return null;

    const event = new ICAL.Event(vevent);
    const dtstart = vevent.getFirstPropertyValue("dtstart") as ICAL.Time;
    const dtend = vevent.getFirstPropertyValue("dtend") as ICAL.Time;

    const allDay = dtstart ? dtstart.isDate : false;

    const result: CalendarEvent = {
      uid: event.uid || filename,
      summary: event.summary || "(no title)",
      start: dtstart ? dtstart.toJSDate() : new Date(0),
      end: dtend ? dtend.toJSDate() : (dtstart ? dtstart.toJSDate() : new Date(0)),
      allDay,
      status: String(vevent.getFirstPropertyValue("status") || "CONFIRMED"),
      filename,
    };
    if (event.description) result.description = event.description;
    if (event.location) result.location = event.location;
    return result;
  } catch {
    return null;
  }
}

/**
 * Load all events from the calendar directory, sorted by start time.
 */
export async function loadAllEvents(
  calendarDir: string
): Promise<CalendarEvent[]> {
  let files: string[];
  try {
    files = await fs.readdir(calendarDir);
  } catch {
    return [];
  }

  const icsFiles = files.filter((f) => f.endsWith(".ics"));
  const events: CalendarEvent[] = [];

  for (const file of icsFiles) {
    const content = await fs.readFile(path.join(calendarDir, file), "utf-8");
    const event = parseIcsContent(content, file);
    if (event && event.status !== "CANCELLED") {
      events.push(event);
    }
  }

  events.sort((a, b) => a.start.getTime() - b.start.getTime());
  return events;
}

/**
 * Filter events to those overlapping the given date range.
 */
export function filterByDateRange(
  events: CalendarEvent[],
  range: { from: Date; to: Date }
): CalendarEvent[] {
  return events.filter(
    (e) => e.start < range.to && e.end > range.from
  );
}

/**
 * Format an event for terminal display.
 */
export function formatEvent(event: CalendarEvent): string {
  const dayStr = event.start.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  if (event.allDay) {
    return `${dayStr}  all day      ${event.summary}`;
  }

  const startTime = event.start.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const endTime = event.end.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return `${dayStr}  ${startTime}-${endTime}  ${event.summary}`;
}
