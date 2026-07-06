/**
 * Calendar utilities — parse .ics files and query events.
 *
 * Reads from local store/calendar/*.ics files. No API calls.
 * Supports recurring events via RRULE expansion using ical.js.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
// eslint-disable-next-line import-x/no-rename-default
import ICAL from "ical.js";

class InvalidTimespanError extends Error {
  constructor(input: string) {
    super(`Invalid timespan: "${input}". Use e.g. "7d", "2w", "1m".`);
    this.name = "InvalidTimespanError";
  }
}

class UnknownTimespanUnitError extends Error {
  constructor(unit: string) {
    super(`Unknown timespan unit: "${unit}"`);
    this.name = "UnknownTimespanUnitError";
  }
}

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
  /** True if this event is from a recurring series */
  recurring?: boolean;
}

/**
 * Shared metadata extracted from a VEVENT component.
 */
interface VeventMeta {
  summary: string;
  description?: string;
  location?: string;
  status: string;
  opaque: boolean;
  calendarId?: string;
  calendarName?: string;
  calendarRole?: string;
}

function extractMeta(vevent: ICAL.Component): VeventMeta {
  const event = new ICAL.Event(vevent);
  const transp = String(vevent.getFirstPropertyValue("transp") || "OPAQUE").toUpperCase();
  const calId = vevent.getFirstPropertyValue("x-cb-calendar-id");
  const calName = vevent.getFirstPropertyValue("x-cb-calendar-name");
  const calRole = vevent.getFirstPropertyValue("x-cb-calendar-role");

  const meta: VeventMeta = {
    summary: event.summary || "(no title)",
    status: String(vevent.getFirstPropertyValue("status") || "CONFIRMED"),
    opaque: transp !== "TRANSPARENT",
  };
  if (event.description) meta.description = event.description;
  if (event.location) meta.location = event.location;
  if (calId) meta.calendarId = String(calId);
  if (calName) meta.calendarName = String(calName);
  if (calRole) meta.calendarRole = String(calRole);
  return meta;
}

/**
 * Parse a single .ics file into CalendarEvent(s).
 * Non-recurring events return a single event.
 * Recurring events are expanded within the given date range.
 * Without a range, recurring events return only their first occurrence.
 */
export function parseIcsContent(
  content: string,
  opts: { filename: string; range?: { from: Date; to: Date } },
): CalendarEvent[] {
  const { filename, range } = opts;
  try {
    const parsed = ICAL.parse(content);
    const comp = new ICAL.Component(parsed);
    const vevent = comp.getFirstSubcomponent("vevent");
    if (!vevent) return [];

    const event = new ICAL.Event(vevent);
    const meta = extractMeta(vevent);

    if (meta.status === "CANCELLED") return [];

    // Check if this is a recurring event
    if (event.isRecurring() && range) {
      return expandRecurring(event, { meta, filename, range });
    }

    // Non-recurring event (or no range given): parse directly
    const dtstart = vevent.getFirstPropertyValue("dtstart") as ICAL.Time;
    const dtend = vevent.getFirstPropertyValue("dtend") as ICAL.Time;
    const allDay = dtstart ? dtstart.isDate : false;

    const result: CalendarEvent = {
      uid: event.uid || filename,
      summary: meta.summary,
      start: dtstart ? dtstart.toJSDate() : new Date(0),
      end: dtend ? dtend.toJSDate() : (dtstart ? dtstart.toJSDate() : new Date(0)),
      allDay,
      status: meta.status,
      opaque: meta.opaque,
      filename,
    };
    if (meta.description) result.description = meta.description;
    if (meta.location) result.location = meta.location;
    if (meta.calendarId) result.calendarId = meta.calendarId;
    if (meta.calendarName) result.calendarName = meta.calendarName;
    if (meta.calendarRole) result.calendarRole = meta.calendarRole;
    return [result];
  } catch (err: unknown) {
    console.warn(`Failed to parse ${opts.filename}:`, err);
    return [];
  }
}

/**
 * Expand a recurring event into individual occurrences within a date range.
 */
function expandRecurring(
  event: ICAL.Event,
  opts: { meta: VeventMeta; filename: string; range: { from: Date; to: Date } },
): CalendarEvent[] {
  const { meta, filename, range } = opts;
  const results: CalendarEvent[] = [];
  const rangeStart = ICAL.Time.fromJSDate(range.from, false);
  const rangeEnd = ICAL.Time.fromJSDate(range.to, false);

  // Calculate duration from first occurrence for computing end times
  const dtstart = event.startDate;
  const dtend = event.endDate;
  const duration = dtend && dtstart
    ? dtend.subtractDate(dtstart)
    : null;

  const iter = event.iterator();
  let occurrence: ICAL.Time | null;
  // Safety limit to prevent infinite loops on broken RRULEs
  let count = 0;
  const MAX_EXPANSIONS = 500;

  while ((occurrence = iter.next()) && count < MAX_EXPANSIONS) {
    // Past our range — stop iterating
    if (occurrence.compare(rangeEnd) >= 0) break;
    // Before our range — skip (but count toward limit)
    if (occurrence.compare(rangeStart) < 0) {
      count++;
      continue;
    }
    count++;

    const occStart = occurrence.toJSDate();
    let occEnd: Date;
    if (duration) {
      const endTime = occurrence.clone();
      endTime.addDuration(duration);
      occEnd = endTime.toJSDate();
    } else {
      occEnd = occStart;
    }

    const allDay = occurrence.isDate;

    const result: CalendarEvent = {
      uid: event.uid || filename,
      summary: meta.summary,
      start: occStart,
      end: occEnd,
      allDay,
      status: meta.status,
      opaque: meta.opaque,
      filename,
      recurring: true,
    };
    if (meta.description) result.description = meta.description;
    if (meta.location) result.location = meta.location;
    if (meta.calendarId) result.calendarId = meta.calendarId;
    if (meta.calendarName) result.calendarName = meta.calendarName;
    if (meta.calendarRole) result.calendarRole = meta.calendarRole;
    results.push(result);
  }

  return results;
}

/**
 * Load events from the calendar directory within a date range, sorted by start time.
 * Recurring events are expanded into individual occurrences.
 */
export async function loadAllEvents(
  calendarDir: string,
  range?: { from: Date; to: Date },
): Promise<CalendarEvent[]> {
  let files: string[];
  try {
    files = await fs.readdir(calendarDir);
  } catch (e) {
    // Calendar dir may not exist (no calendar synced yet) — that's a normal
    // empty result. Log so a permissions/IO failure isn't mistaken for "no
    // events".
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Could not read calendar dir ${calendarDir}, returning no events:`, e);
    }
    return [];
  }

  const icsFiles = files.filter((f) => f.endsWith(".ics"));
  const events: CalendarEvent[] = [];

  for (const file of icsFiles) {
    const content = await fs.readFile(path.join(calendarDir, file), "utf-8");
    const parsed = parseIcsContent(content, { filename: file, ...(range ? { range } : {}) });
    events.push(...parsed);
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
 * Validate that non-all-day events in an ICS file have timezone info (TZID on DTSTART).
 * Returns null if valid, or an error message string if invalid.
 */
export function validateIcsTimezone(content: string): string | null {
  try {
    const parsed = ICAL.parse(content);
    const comp = new ICAL.Component(parsed);
    const vevent = comp.getFirstSubcomponent("vevent");
    if (!vevent) return "No VEVENT component found";

    const dtstart = vevent.getFirstProperty("dtstart");
    if (!dtstart) return "No DTSTART property found";

    const dtValue = dtstart.getFirstValue() as ICAL.Time;
    if (dtValue && dtValue.isDate) return null; // All-day event — no timezone needed

    const tzid = dtstart.getParameter("tzid");
    if (!tzid) {
      return "Non-all-day event missing TZID on DTSTART. Include a VTIMEZONE component and TZID parameter (e.g., DTSTART;TZID=America/Chicago:20260401T140000).";
    }

    return null;
  } catch (err: unknown) {
    return `Failed to parse ICS: ${err}`;
  }
}

/**
 * Parse a timespan string like "3d", "2w", "1m" into milliseconds from now.
 * Supports: Nd (days), Nw (weeks), Nm (months, approximated as 30d).
 * Plain number treated as days.
 */
export function parseTimespan(input: string): number {
  const match = input.match(/^(\d+)\s*([dmw]?)$/i);
  if (!match) {
    throw new InvalidTimespanError(input);
  }
  const n = parseInt(match[1]!, 10);
  const unit = (match[2] || "d").toLowerCase();
  const DAY = 24 * 60 * 60 * 1000;
  switch (unit) {
    case "d": return n * DAY;
    case "w": return n * 7 * DAY;
    case "m": return n * 30 * DAY;
    default:
      // The regex above only admits d/w/m (empty defaulted to "d"), so this is
      // unreachable — but throw rather than silently treat an unknown unit as
      // days, matching the throwing duration parsers elsewhere.
      throw new UnknownTimespanUnitError(unit);
  }
}
