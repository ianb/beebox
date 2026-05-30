/**
 * Google Calendar ICS transformation — pure conversion between Google Calendar
 * API event objects and .ics file content. No API calls, no filesystem.
 * Recurring events are stored as compact masters with RRULEs; VTIMEZONE
 * components are built from the IANA name via the Intl API (current-year only).
 */

// eslint-disable-next-line import-x/no-rename-default
import ICAL from "ical.js";
import { type CalendarEvent } from "../services/google-calendar.js";

export type GoogleCalendarEvent = CalendarEvent;

/**
 * Parse local time parts from an ISO dateTime string (e.g., "2026-03-29T14:00:00-05:00").
 * The time in the string IS the local time — we extract it directly without UTC conversion.
 */
function parseLocalTimeParts(dateTime: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } | null {
  const match = dateTime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;
  return {
    year: parseInt(match[1]!, 10),
    month: parseInt(match[2]!, 10),
    day: parseInt(match[3]!, 10),
    hour: parseInt(match[4]!, 10),
    minute: parseInt(match[5]!, 10),
    second: parseInt(match[6]!, 10),
  };
}

/** Offset in minutes between a date's wall-clock time in tzid and UTC. */
function getOffsetMinutes(date: Date, tzid: string): number {
  const utcParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", hour12: false,
  }).formatToParts(date);
  const tzParts = new Intl.DateTimeFormat("en-US", {
    timeZone: tzid,
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", hour12: false,
  }).formatToParts(date);

  function toMinutes(parts: Intl.DateTimeFormatPart[]): number {
    const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value || "0", 10);
    return ((get("year") * 365 + get("month") * 31 + get("day")) * 24 + get("hour")) * 60 + get("minute");
  }
  return toMinutes(tzParts) - toMinutes(utcParts);
}

/**
 * ical.js's utc-offset property type expects input in the colon-separated
 * form "+HH:MM" (it strips the colon on serialization via slice(0,3)+slice(4,6)).
 * Passing "+HHMM" without the colon produces a truncated "+HH0" in the .ics output.
 */
function formatOffset(minutes: number): string {
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  const h = String(Math.floor(abs / 60)).padStart(2, "0");
  const m = String(abs % 60).padStart(2, "0");
  return `${sign}${h}:${m}`;
}

/** Build a no-DST VTIMEZONE with a single STANDARD component. */
function addStandardOnly(vtimezone: ICAL.Component, opts: { offset: number; name: string }): void {
  const { offset, name } = opts;
  const standard = new ICAL.Component("standard");
  standard.updatePropertyWithValue("dtstart", ICAL.Time.fromDateTimeString("1970-01-01T00:00:00"));
  standard.updatePropertyWithValue("tzoffsetfrom", formatOffset(offset));
  standard.updatePropertyWithValue("tzoffsetto", formatOffset(offset));
  standard.updatePropertyWithValue("tzname", name);
  vtimezone.addSubcomponent(standard);
}

/** Build STANDARD + DAYLIGHT subcomponents for a DST-observing zone. */
function addDstComponents(
  vtimezone: ICAL.Component,
  opts: { janOffset: number; julOffset: number; janName: string; julName: string },
): void {
  const { janOffset, julOffset, janName, julName } = opts;
  const stdOffset = Math.min(janOffset, julOffset);
  const dstOffset = Math.max(janOffset, julOffset);
  const stdName = janOffset < julOffset ? janName : julName;
  const dstName = janOffset < julOffset ? julName : janName;

  // Northern hemisphere: standard starts in Nov, daylight in Mar. Southern: reversed.
  const northernHemisphere = julOffset > janOffset;

  const standard = new ICAL.Component("standard");
  standard.updatePropertyWithValue("dtstart",
    ICAL.Time.fromDateTimeString(northernHemisphere ? "1970-11-01T02:00:00" : "1970-04-01T03:00:00"));
  standard.updatePropertyWithValue("rrule", ICAL.Recur.fromString(
    northernHemisphere ? "FREQ=YEARLY;BYMONTH=11;BYDAY=1SU" : "FREQ=YEARLY;BYMONTH=4;BYDAY=1SU"));
  standard.updatePropertyWithValue("tzoffsetfrom", formatOffset(dstOffset));
  standard.updatePropertyWithValue("tzoffsetto", formatOffset(stdOffset));
  standard.updatePropertyWithValue("tzname", stdName);
  vtimezone.addSubcomponent(standard);

  const daylight = new ICAL.Component("daylight");
  daylight.updatePropertyWithValue("dtstart",
    ICAL.Time.fromDateTimeString(northernHemisphere ? "1970-03-08T02:00:00" : "1970-10-04T02:00:00"));
  daylight.updatePropertyWithValue("rrule", ICAL.Recur.fromString(
    northernHemisphere ? "FREQ=YEARLY;BYMONTH=3;BYDAY=2SU" : "FREQ=YEARLY;BYMONTH=10;BYDAY=1SU"));
  daylight.updatePropertyWithValue("tzoffsetfrom", formatOffset(stdOffset));
  daylight.updatePropertyWithValue("tzoffsetto", formatOffset(dstOffset));
  daylight.updatePropertyWithValue("tzname", dstName);
  vtimezone.addSubcomponent(daylight);
}

/**
 * Generate a VTIMEZONE component for an IANA timezone name.
 * Uses Intl API to determine current-year offsets for STANDARD and DAYLIGHT.
 *
 * Note: ICAL.Time.fromDateTimeString requires ISO 8601 "extended" format
 * (YYYY-MM-DDTHH:MM:SS, 19+ chars) — it rejects the iCal "basic" format
 * (YYYYMMDDTHHMMSS). The serialized output in the .ics file still uses the
 * basic format per RFC 5545; only the parser input needs the separators.
 */
function generateVtimezone(tzid: string): ICAL.Component {
  const vtimezone = new ICAL.Component("vtimezone");
  vtimezone.updatePropertyWithValue("tzid", tzid);

  // Sample offsets at mid-January (standard) and mid-July (daylight) of current year
  const year = new Date().getFullYear();
  const jan = new Date(year, 0, 15, 12, 0, 0);
  const jul = new Date(year, 6, 15, 12, 0, 0);

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tzid,
    timeZoneName: "shortOffset",
    hour: "numeric",
  });

  function getTzName(date: Date): string {
    const parts = fmt.formatToParts(date);
    const tzPart = parts.find((p) => p.type === "timeZoneName");
    return tzPart?.value || tzid;
  }

  const janOffset = getOffsetMinutes(jan, tzid);
  const julOffset = getOffsetMinutes(jul, tzid);
  const janName = getTzName(jan);
  const julName = getTzName(jul);

  if (janOffset === julOffset) {
    addStandardOnly(vtimezone, { offset: janOffset, name: janName });
  } else {
    addDstComponents(vtimezone, { janOffset, julOffset, janName, julName });
  }

  return vtimezone;
}

/**
 * Set a datetime property with timezone on a VEVENT component.
 * Parses local time from the ISO string and sets TZID parameter.
 */
function setDateTimeWithTz(
  vevent: ICAL.Component,
  opts: { propName: string; dateTime: string; timeZone: string | undefined },
): void {
  const { propName, dateTime, timeZone } = opts;
  const parts = parseLocalTimeParts(dateTime);
  if (parts && timeZone) {
    // Format as ISO 8601 extended ("2026-04-01T14:00:00"). fromDateTimeString
    // rejects iCal basic format; see note in generateVtimezone above.
    const pad = (n: number, w: number) => String(n).padStart(w, "0");
    const dtStr = `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}T${pad(parts.hour, 2)}:${pad(parts.minute, 2)}:${pad(parts.second, 2)}`;
    const dt = ICAL.Time.fromDateTimeString(dtStr);
    const prop = vevent.updatePropertyWithValue(propName, dt);
    prop.setParameter("tzid", timeZone);
  } else {
    // No timezone or unparseable — use JS Date conversion (UTC-based)
    const dt = ICAL.Time.fromJSDate(new Date(dateTime), false);
    vevent.updatePropertyWithValue(propName, dt);
  }
}

/** Set dtstart/dtend on a VEVENT from an event start/end object. */
function setEventTime(
  vevent: ICAL.Component,
  opts: { propName: "dtstart" | "dtend"; time: { dateTime?: string; date?: string; timeZone?: string } },
): void {
  const { propName, time } = opts;
  if (time.dateTime) {
    setDateTimeWithTz(vevent, { propName, dateTime: time.dateTime, timeZone: time.timeZone });
  } else if (time.date) {
    const dt = ICAL.Time.fromDateString(time.date);
    const prop = vevent.updatePropertyWithValue(propName, dt);
    prop.setParameter("value", "DATE");
  }
}

/** Set STATUS and TRANSP properties on a VEVENT from a Google event. */
function setStatusAndTransparency(vevent: ICAL.Component, event: GoogleCalendarEvent): void {
  if (event.status === "cancelled") {
    vevent.updatePropertyWithValue("status", "CANCELLED");
  } else if (event.status === "tentative") {
    vevent.updatePropertyWithValue("status", "TENTATIVE");
  } else {
    vevent.updatePropertyWithValue("status", "CONFIRMED");
  }

  if (event.transparency === "transparent") {
    vevent.updatePropertyWithValue("transp", "TRANSPARENT");
  } else {
    vevent.updatePropertyWithValue("transp", "OPAQUE");
  }
}

/** Add ORGANIZER and ATTENDEE properties to a VEVENT from a Google event. */
function addParticipants(vevent: ICAL.Component, event: GoogleCalendarEvent): void {
  if (event.organizer?.email) {
    const prop = new ICAL.Property("organizer");
    prop.setValue(`mailto:${event.organizer.email}`);
    if (event.organizer.displayName) {
      prop.setParameter("cn", event.organizer.displayName);
    }
    vevent.addProperty(prop);
  }

  if (!event.attendees) return;
  for (const att of event.attendees) {
    if (!att.email) continue;
    const prop = new ICAL.Property("attendee");
    prop.setValue(`mailto:${att.email}`);
    if (att.displayName) {
      prop.setParameter("cn", att.displayName);
    }
    if (att.responseStatus) {
      const statusMap: Record<string, string> = {
        accepted: "ACCEPTED",
        declined: "DECLINED",
        tentative: "TENTATIVE",
        needsAction: "NEEDS-ACTION",
      };
      prop.setParameter(
        "partstat",
        statusMap[att.responseStatus] || att.responseStatus.toUpperCase()
      );
    }
    vevent.addProperty(prop);
  }
}

export function eventToIcs(
  event: GoogleCalendarEvent,
  opts: { calendarId: string; calendarName?: string; calendarRole?: string },
): string {
  const { calendarId, calendarName, calendarRole } = opts;
  const comp = new ICAL.Component(["vcalendar", [], []]);
  comp.updatePropertyWithValue("prodid", "-//Callback Box//EN");
  comp.updatePropertyWithValue("version", "2.0");

  // Collect timezones used by this event and add VTIMEZONE components
  const timezones = new Set<string>();
  const startTz = event.start?.timeZone;
  const endTz = event.end?.timeZone;
  if (startTz) timezones.add(startTz);
  if (endTz) timezones.add(endTz);
  for (const tz of timezones) {
    comp.addSubcomponent(generateVtimezone(tz));
  }

  const vevent = new ICAL.Component("vevent");
  comp.addSubcomponent(vevent);

  vevent.updatePropertyWithValue("uid", event.iCalUID || event.id);
  vevent.updatePropertyWithValue("summary", event.summary || "(no title)");

  if (event.description) {
    vevent.updatePropertyWithValue("description", event.description);
  }
  if (event.location) {
    vevent.updatePropertyWithValue("location", event.location);
  }

  if (event.start) setEventTime(vevent, { propName: "dtstart", time: event.start });
  if (event.end) setEventTime(vevent, { propName: "dtend", time: event.end });

  if (event.created) {
    vevent.updatePropertyWithValue("created", ICAL.Time.fromJSDate(new Date(event.created), true));
  }
  if (event.updated) {
    vevent.updatePropertyWithValue("last-modified", ICAL.Time.fromJSDate(new Date(event.updated), true));
  }

  setStatusAndTransparency(vevent, event);
  addParticipants(vevent, event);

  // Recurrence rules (for recurring master events)
  if (event.recurrence) {
    for (const rule of event.recurrence) {
      // Each entry is a raw iCalendar line like "RRULE:FREQ=WEEKLY;BYDAY=MO"
      // or "EXDATE;VALUE=DATE:20240101". Parse via ical.js to handle all formats.
      const prop = ICAL.Property.fromString(rule);
      vevent.addProperty(prop);
    }
  }

  // Source calendar tracking
  vevent.updatePropertyWithValue("x-cb-calendar-id", calendarId);
  if (calendarName) {
    vevent.updatePropertyWithValue("x-cb-calendar-name", calendarName);
  }
  if (calendarRole) {
    vevent.updatePropertyWithValue("x-cb-calendar-role", calendarRole);
  }

  return comp.toString();
}

export function eventFilename(event: GoogleCalendarEvent): string {
  const dateStr =
    event.start?.dateTime?.slice(0, 10) ||
    event.start?.date ||
    "no-date";
  const shortId = event.id.slice(-8);
  return `${dateStr}_${shortId}.ics`;
}

/** Check if an event's start falls within a time window */
export function isInWindow(event: GoogleCalendarEvent, window: { start: Date; end: Date }): boolean {
  // Recurring masters: Google already filtered server-side via timeMin/timeMax
  if (event.recurrence) return true;
  const dateTime = event.start?.dateTime;
  const dateOnly = event.start?.date;
  if (!dateTime && !dateOnly) return true;
  const eventStart = dateTime ? new Date(dateTime) : new Date(dateOnly + "T00:00:00");
  return eventStart >= window.start && eventStart <= window.end;
}

/** Read dtstart/dtend off a parsed VEVENT into a Google start/end object. */
function readEventTime(
  vevent: ICAL.Component,
  propName: "dtstart" | "dtend",
): { date?: string; dateTime?: string; timeZone?: string } | undefined {
  const prop = vevent.getFirstProperty(propName);
  const value = prop ? (prop.getFirstValue() as ICAL.Time | null) : null;
  if (!value) return undefined;
  if (value.isDate) {
    return { date: value.toString() };
  }
  const tzid = prop?.getParameter("tzid");
  const result: { dateTime: string; timeZone?: string } = { dateTime: value.toJSDate().toISOString() };
  if (tzid) result.timeZone = String(tzid);
  return result;
}

/**
 * Parse a local .ics file back into a Google Calendar API event object.
 * Returns null if the file can't be parsed.
 * Includes _calendarId from X-CB-CALENDAR-ID if present.
 */
export function icsToGoogleEvent(content: string): (GoogleCalendarEvent & { _calendarId?: string }) | null {
  try {
    const parsed = ICAL.parse(content);
    const comp = new ICAL.Component(parsed);
    const vevent = comp.getFirstSubcomponent("vevent");
    if (!vevent) return null;

    const event = new ICAL.Event(vevent);
    const result: GoogleCalendarEvent & { _calendarId?: string } = {
      id: "",
      status: "confirmed",
      summary: event.summary || "(no title)",
    };

    if (event.description) result.description = event.description;
    if (event.location) result.location = event.location;

    const start = readEventTime(vevent, "dtstart");
    if (start) result.start = start;
    const end = readEventTime(vevent, "dtend");
    if (end) result.end = end;

    // Transparency
    const transp = String(vevent.getFirstPropertyValue("transp") || "OPAQUE").toUpperCase();
    if (transp === "TRANSPARENT") {
      result.transparency = "transparent";
    }

    // Recurrence rules
    const rrules = vevent.getAllProperties("rrule");
    if (rrules.length > 0) {
      result.recurrence = rrules.map((p: ICAL.Property) => p.toICALString().trim());
    }

    // Source calendar ID
    const calId = vevent.getFirstPropertyValue("x-cb-calendar-id");
    if (calId) result._calendarId = String(calId);

    return result;
  } catch (e) {
    console.warn("Failed to parse local .ics file, skipping:", e);
    return null;
  }
}
