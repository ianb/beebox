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
  /** true if the event's TRANSP is OPAQUE (default), false if TRANSPARENT */
  opaque: boolean;
  /** Source calendar ID from X-CB-CALENDAR-ID */
  calendarId?: string;
  /** Source calendar display name from X-CB-CALENDAR-NAME */
  calendarName?: string;
  /** Source calendar access role from X-CB-CALENDAR-ROLE (owner, writer, reader) */
  calendarRole?: string;
  /** Just the filename, e.g. "2026-02-18_abc123.ics" */
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

    const transp = String(vevent.getFirstPropertyValue("transp") || "OPAQUE").toUpperCase();

    const calId = vevent.getFirstPropertyValue("x-cb-calendar-id");
    const calName = vevent.getFirstPropertyValue("x-cb-calendar-name");
    const calRole = vevent.getFirstPropertyValue("x-cb-calendar-role");

    const result: CalendarEvent = {
      uid: event.uid || filename,
      summary: event.summary || "(no title)",
      start: dtstart ? dtstart.toJSDate() : new Date(0),
      end: dtend ? dtend.toJSDate() : (dtstart ? dtstart.toJSDate() : new Date(0)),
      allDay,
      status: String(vevent.getFirstPropertyValue("status") || "CONFIRMED"),
      opaque: transp !== "TRANSPARENT",
      filename,
    };
    if (event.description) result.description = event.description;
    if (event.location) result.location = event.location;
    if (calId) result.calendarId = String(calId);
    if (calName) result.calendarName = String(calName);
    if (calRole) result.calendarRole = String(calRole);
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
 *
 * Format:
 *   Mon Feb 17  10:00-11:00  Weekly standup  [loc]
 *   Mon Feb 17  14:00-15:00  Team lunch  [free]
 *   Tue Feb 18  all day      Dentist
 *   Fri Feb 20  19:00-21:00  GRS Musical  (GRS School Calendar)
 *
 * Events on owned calendars: show [free] only if transparent.
 * Events on subscribed calendars: show calendar name in parens.
 */
export function formatEvent(event: CalendarEvent): string {
  const dayStr = event.start.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  let timeStr: string;
  if (event.allDay) {
    timeStr = "all day     ";
  } else {
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
    timeStr = `${startTime}-${endTime}`;
  }

  const isOwned = !event.calendarRole || event.calendarRole === "owner" || event.calendarRole === "writer";

  const tags: string[] = [];
  // Only show [free] for events on owned calendars that are explicitly transparent
  if (isOwned && !event.opaque) tags.push("free");
  if (event.location) tags.push("loc");
  if (event.description) tags.push("desc");
  const tagStr = tags.length > 0 ? `  [${tags.join(", ")}]` : "";

  // Show calendar name for subscribed (non-owned) calendars
  const calStr = !isOwned && event.calendarName
    ? `  (${event.calendarName})`
    : "";

  return `${dayStr}  ${timeStr}  ${event.summary}${tagStr}${calStr}`;
}

/**
 * Parse a timespan string like "3d", "2w", "1m" into milliseconds from now.
 * Supports: Nd (days), Nw (weeks), Nm (months, approximated as 30d).
 * Plain number treated as days.
 */
export function parseTimespan(input: string): number {
  const match = input.match(/^(\d+)\s*([dwm]?)$/i);
  if (!match) {
    throw new Error(`Invalid timespan: "${input}". Use e.g. "7d", "2w", "1m".`);
  }
  const n = parseInt(match[1]!, 10);
  const unit = (match[2] || "d").toLowerCase();
  const DAY = 24 * 60 * 60 * 1000;
  switch (unit) {
    case "d": return n * DAY;
    case "w": return n * 7 * DAY;
    case "m": return n * 30 * DAY;
    default: return n * DAY;
  }
}
