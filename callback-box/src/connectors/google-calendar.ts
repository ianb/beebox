/**
 * Google Calendar Connector — Syncs calendar events as .ics files.
 *
 * Configuration:
 *   config/connectors/google-calendar.json       - { "calendars": ["primary"], "syncDaysBack": 30, "syncDaysForward": 90 }
 *   config/connectors/google-calendar-state.json  - { syncTokens, eventFiles }
 *   config/connectors/google.secret.json          - shared Google OAuth2 credentials
 *
 * Events are stored as individual .ics files in store/calendar/.
 * Uses singleEvents=false so recurring events are returned as compact masters
 * with RRULEs (expanded at query time by calendar-utils.ts).
 * Exception instances (single overrides of recurring events) are skipped.
 * Incremental sync may return events outside the time window, so we filter
 * client-side. Filename format: {YYYY-MM-DD}_{shortId}.ics
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import ky, { type HTTPError } from "ky";
// eslint-disable-next-line import-x/no-rename-default
import ICAL from "ical.js";
import type { OAuth2Client } from "google-auth-library";
import {
  registerConnector,
  type Connector,
  type SyncResult,
} from "./index.js";
import { getGoogleAuth } from "./google-auth.js";
import { isGoogleServiceAllowed } from "../webapp/box-config.js";
import {
  loadCalendarConfig,
  saveCalendarConfig,
  fetchAvailableCalendars,
  type CalendarConfig,
} from "./calendar-config.js";
import { validateIcsTimezone } from "./calendar-utils.js";
import { stageFiles, commit, getStatus } from "../cli/lib/git.js";
import {
  createCalendarReviewJobTemplate,
  type CalendarChangeInput,
} from "../schemas/calendar-review-job.js";
import { getBoxTimeISO } from "../cli/lib/time.js";
import { loadTransientState, saveTransientState } from "./transient-state.js";

interface CalendarTransientState {
  syncTokens: Record<string, string>;
}

interface EventFileEntry {
  filename: string;
  calendarId: string;
  /** Hash of the ICS content last written by the connector (for detecting local edits) */
  contentHash?: string;
}

interface CalendarState {
  /** syncToken per calendar ID */
  syncTokens: Record<string, string>;
  /** Google event ID → file info (or legacy plain filename string) */
  eventFiles: Record<string, string | EventFileEntry>;
}

/** Get filename from eventFiles entry (handles legacy string format) */
function getFilename(entry: string | EventFileEntry): string {
  return typeof entry === "string" ? entry : entry.filename;
}

/** Short content hash for detecting local edits to .ics files */
function contentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

interface GoogleCalendarEvent {
  id: string;
  status: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  created?: string;
  updated?: string;
  recurrence?: string[];
  recurringEventId?: string;
  organizer?: { email?: string; displayName?: string };
  attendees?: Array<{
    email?: string;
    displayName?: string;
    responseStatus?: string;
  }>;
  iCalUID?: string;
  /** "opaque" = busy (default), "transparent" = free */
  transparency?: string;
}

interface GoogleCalendarListResponse {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

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

/**
 * Generate a VTIMEZONE component for an IANA timezone name.
 * Uses Intl API to determine current-year offsets for STANDARD and DAYLIGHT.
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

  function getOffsetMinutes(date: Date): number {
    // Get UTC time and local time in the target timezone, compute difference
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

  function formatOffset(minutes: number): string {
    const sign = minutes >= 0 ? "+" : "-";
    const abs = Math.abs(minutes);
    const h = String(Math.floor(abs / 60)).padStart(2, "0");
    const m = String(abs % 60).padStart(2, "0");
    return `${sign}${h}${m}`;
  }

  function getTzName(date: Date): string {
    const parts = fmt.formatToParts(date);
    const tzPart = parts.find((p) => p.type === "timeZoneName");
    return tzPart?.value || tzid;
  }

  const janOffset = getOffsetMinutes(jan);
  const julOffset = getOffsetMinutes(jul);
  const janName = getTzName(jan);
  const julName = getTzName(jul);

  if (janOffset === julOffset) {
    // No DST — just STANDARD
    const standard = new ICAL.Component("standard");
    standard.updatePropertyWithValue("dtstart", ICAL.Time.fromDateTimeString("19700101T000000"));
    standard.updatePropertyWithValue("tzoffsetfrom", formatOffset(janOffset));
    standard.updatePropertyWithValue("tzoffsetto", formatOffset(janOffset));
    standard.updatePropertyWithValue("tzname", janName);
    vtimezone.addSubcomponent(standard);
  } else {
    // Has DST — determine which is standard vs daylight
    const stdOffset = Math.min(janOffset, julOffset);
    const dstOffset = Math.max(janOffset, julOffset);
    const stdName = janOffset < julOffset ? janName : julName;
    const dstName = janOffset < julOffset ? julName : janName;

    // Northern hemisphere: standard starts in Nov, daylight in Mar
    // Southern hemisphere: reversed
    const northernHemisphere = julOffset > janOffset;

    const standard = new ICAL.Component("standard");
    standard.updatePropertyWithValue("dtstart",
      ICAL.Time.fromDateTimeString(northernHemisphere ? "19701101T020000" : "19700401T030000"));
    if (northernHemisphere) {
      standard.updatePropertyWithValue("rrule", ICAL.Recur.fromString("FREQ=YEARLY;BYMONTH=11;BYDAY=1SU"));
    } else {
      standard.updatePropertyWithValue("rrule", ICAL.Recur.fromString("FREQ=YEARLY;BYMONTH=4;BYDAY=1SU"));
    }
    standard.updatePropertyWithValue("tzoffsetfrom", formatOffset(dstOffset));
    standard.updatePropertyWithValue("tzoffsetto", formatOffset(stdOffset));
    standard.updatePropertyWithValue("tzname", stdName);
    vtimezone.addSubcomponent(standard);

    const daylight = new ICAL.Component("daylight");
    daylight.updatePropertyWithValue("dtstart",
      ICAL.Time.fromDateTimeString(northernHemisphere ? "19700308T020000" : "19701004T020000"));
    if (northernHemisphere) {
      daylight.updatePropertyWithValue("rrule", ICAL.Recur.fromString("FREQ=YEARLY;BYMONTH=3;BYDAY=2SU"));
    } else {
      daylight.updatePropertyWithValue("rrule", ICAL.Recur.fromString("FREQ=YEARLY;BYMONTH=10;BYDAY=1SU"));
    }
    daylight.updatePropertyWithValue("tzoffsetfrom", formatOffset(stdOffset));
    daylight.updatePropertyWithValue("tzoffsetto", formatOffset(dstOffset));
    daylight.updatePropertyWithValue("tzname", dstName);
    vtimezone.addSubcomponent(daylight);
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
    // Format as iCal datetime string: "20260401T140000"
    const pad = (n: number, w: number) => String(n).padStart(w, "0");
    const dtStr = `${pad(parts.year, 4)}${pad(parts.month, 2)}${pad(parts.day, 2)}T${pad(parts.hour, 2)}${pad(parts.minute, 2)}${pad(parts.second, 2)}`;
    const dt = ICAL.Time.fromDateTimeString(dtStr);
    const prop = vevent.updatePropertyWithValue(propName, dt);
    prop.setParameter("tzid", timeZone);
  } else {
    // No timezone or unparseable — use JS Date conversion (UTC-based)
    const dt = ICAL.Time.fromJSDate(new Date(dateTime), false);
    vevent.updatePropertyWithValue(propName, dt);
  }
}

function eventToIcs(
  event: GoogleCalendarEvent,
  opts: { calendarId: string; calendarName?: string; calendarRole?: string },
): string {
  const { calendarId, calendarName, calendarRole } = opts;
  const comp = new ICAL.Component(["vcalendar", [], []]);
  comp.updatePropertyWithValue("prodid", "-//Callback Box//EN");
  comp.updatePropertyWithValue("version", "2.0");

  // Collect timezones used by this event and add VTIMEZONE components
  const timezones = new Set<string>();
  if (event.start?.timeZone) timezones.add(event.start.timeZone);
  if (event.end?.timeZone) timezones.add(event.end.timeZone);
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

  // Start time
  if (event.start) {
    if (event.start.dateTime) {
      setDateTimeWithTz(vevent, { propName: "dtstart", dateTime: event.start.dateTime, timeZone: event.start.timeZone });
    } else if (event.start.date) {
      const dt = ICAL.Time.fromDateString(event.start.date);
      const prop = vevent.updatePropertyWithValue("dtstart", dt);
      prop.setParameter("value", "DATE");
    }
  }

  // End time
  if (event.end) {
    if (event.end.dateTime) {
      setDateTimeWithTz(vevent, { propName: "dtend", dateTime: event.end.dateTime, timeZone: event.end.timeZone });
    } else if (event.end.date) {
      const dt = ICAL.Time.fromDateString(event.end.date);
      const prop = vevent.updatePropertyWithValue("dtend", dt);
      prop.setParameter("value", "DATE");
    }
  }

  if (event.created) {
    vevent.updatePropertyWithValue(
      "created",
      ICAL.Time.fromJSDate(new Date(event.created), true)
    );
  }
  if (event.updated) {
    vevent.updatePropertyWithValue(
      "last-modified",
      ICAL.Time.fromJSDate(new Date(event.updated), true)
    );
  }

  if (event.status === "cancelled") {
    vevent.updatePropertyWithValue("status", "CANCELLED");
  } else if (event.status === "tentative") {
    vevent.updatePropertyWithValue("status", "TENTATIVE");
  } else {
    vevent.updatePropertyWithValue("status", "CONFIRMED");
  }

  // Transparency (busy/free)
  if (event.transparency === "transparent") {
    vevent.updatePropertyWithValue("transp", "TRANSPARENT");
  } else {
    vevent.updatePropertyWithValue("transp", "OPAQUE");
  }

  // Organizer
  if (event.organizer?.email) {
    const prop = new ICAL.Property("organizer");
    prop.setValue(`mailto:${event.organizer.email}`);
    if (event.organizer.displayName) {
      prop.setParameter("cn", event.organizer.displayName);
    }
    vevent.addProperty(prop);
  }

  // Attendees
  if (event.attendees) {
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

function eventFilename(event: GoogleCalendarEvent): string {
  const dateStr =
    event.start?.dateTime?.slice(0, 10) ||
    event.start?.date ||
    "no-date";
  const shortId = event.id.slice(-8);
  return `${dateStr}_${shortId}.ics`;
}

/** Check if an event's start falls within a time window */
function isInWindow(event: GoogleCalendarEvent, window: { start: Date; end: Date }): boolean {
  // Recurring masters: Google already filtered server-side via timeMin/timeMax
  if (event.recurrence) return true;
  const dateTime = event.start?.dateTime;
  const dateOnly = event.start?.date;
  if (!dateTime && !dateOnly) return true;
  const eventStart = dateTime ? new Date(dateTime) : new Date(dateOnly + "T00:00:00");
  return eventStart >= window.start && eventStart <= window.end;
}

/**
 * Parse a local .ics file back into a Google Calendar API event object.
 * Returns null if the file can't be parsed.
 * Includes _calendarId from X-CB-CALENDAR-ID if present.
 */
function icsToGoogleEvent(content: string): (GoogleCalendarEvent & { _calendarId?: string }) | null {
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

    // Start time
    const dtstartProp = vevent.getFirstProperty("dtstart");
    const dtstart = dtstartProp ? (dtstartProp.getFirstValue() as ICAL.Time | null) : null;
    if (dtstart) {
      if (dtstart.isDate) {
        result.start = { date: dtstart.toString() };
      } else {
        const startTzid = dtstartProp?.getParameter("tzid");
        result.start = { dateTime: dtstart.toJSDate().toISOString() };
        if (startTzid) result.start.timeZone = String(startTzid);
      }
    }

    // End time
    const dtendProp = vevent.getFirstProperty("dtend");
    const dtend = dtendProp ? (dtendProp.getFirstValue() as ICAL.Time | null) : null;
    if (dtend) {
      if (dtend.isDate) {
        result.end = { date: dtend.toString() };
      } else {
        const endTzid = dtendProp?.getParameter("tzid");
        result.end = { dateTime: dtend.toJSDate().toISOString() };
        if (endTzid) result.end.timeZone = String(endTzid);
      }
    }

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
  } catch {
    return null;
  }
}

interface SyncNote {
  action: "new" | "updated" | "deleted" | "pushed" | "cancelled";
  summary: string;
  detail?: string;
  ref?: string;
  /** Full ICS content for deleted events (embedded in calendar-review job) */
  icsContent?: string;
  /** Event start date for priority heuristic */
  eventStart?: Date;
}

/** Parse event start as a Date (for priority heuristic) */
function parseEventStart(event: GoogleCalendarEvent): Date | undefined {
  const dateTime = event.start?.dateTime;
  const dateOnly = event.start?.date;
  if (!dateTime && !dateOnly) return undefined;
  return dateTime ? new Date(dateTime) : new Date(dateOnly + "T00:00:00");
}

/** Format an event date for commit messages: "Thu Feb 20" or "Thu Feb 20 3:00 PM" */
function formatEventDate(event: GoogleCalendarEvent): string {
  const dateTime = event.start?.dateTime;
  const dateOnly = event.start?.date;
  if (!dateTime && !dateOnly) return "";
  const d = dateTime ? new Date(dateTime) : new Date(dateOnly + "T00:00:00");
  const dayStr = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  if (dateOnly) return dayStr;
  const timeStr = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${dayStr} ${timeStr}`;
}

/** Compare old and new ICS content, return human-readable change descriptions */
function describeChanges(oldContent: string, newContent: string): string[] {
  const changes: string[] = [];
  try {
    const oldComp = new ICAL.Component(ICAL.parse(oldContent));
    const newComp = new ICAL.Component(ICAL.parse(newContent));
    const oldV = oldComp.getFirstSubcomponent("vevent");
    const newV = newComp.getFirstSubcomponent("vevent");
    if (!oldV || !newV) return changes;

    const getProp = (v: ICAL.Component, name: string): string =>
      String(v.getFirstPropertyValue(name) || "");

    // Summary
    const oldSummary = getProp(oldV, "summary");
    const newSummary = getProp(newV, "summary");
    if (oldSummary !== newSummary) {
      changes.push(`title changed from "${oldSummary}" to "${newSummary}"`);
    }

    // Start/end times
    const oldStart = getProp(oldV, "dtstart");
    const newStart = getProp(newV, "dtstart");
    const oldEnd = getProp(oldV, "dtend");
    const newEnd = getProp(newV, "dtend");
    if (oldStart !== newStart || oldEnd !== newEnd) {
      changes.push("time changed");
    }

    // Location
    const oldLoc = getProp(oldV, "location");
    const newLoc = getProp(newV, "location");
    if (oldLoc !== newLoc) {
      if (!oldLoc) {
        changes.push(`added location: ${newLoc}`);
      } else if (!newLoc) {
        changes.push("location removed");
      } else {
        changes.push(`location changed to ${newLoc}`);
      }
    }

    // Description
    const oldDesc = getProp(oldV, "description");
    const newDesc = getProp(newV, "description");
    if (oldDesc !== newDesc) {
      changes.push("description updated");
    }

    // Transparency
    const oldTransp = getProp(oldV, "transp");
    const newTransp = getProp(newV, "transp");
    if (oldTransp !== newTransp) {
      changes.push(newTransp === "TRANSPARENT" ? "marked as free" : "marked as busy");
    }
  } catch {
    // Can't parse — skip diffing
  }
  return changes;
}

/**
 * Extract X-CB-REASON and X-CB-REF from ICS content.
 * Returns the values and stripped content.
 */
function extractCbAnnotations(content: string): { reason?: string; ref?: string; stripped: string } {
  let reason: string | undefined;
  let ref: string | undefined;

  const reasonMatch = content.match(/^x-cb-reason[:;](.*)$/im);
  if (reasonMatch) reason = reasonMatch[1]?.trim();

  const refMatch = content.match(/^x-cb-ref[:;](.*)$/im);
  if (refMatch) ref = refMatch[1]?.trim();

  // Strip the annotation lines
  const stripped = content
    .replace(/^x-cb-reason[:;].*\r?\n?/gim, "")
    .replace(/^x-cb-ref[:;].*\r?\n?/gim, "");

  const result: { reason?: string; ref?: string; stripped: string } = { stripped };
  if (reason) result.reason = reason;
  if (ref) result.ref = ref;
  return result;
}

/** Build narrative commit message from SyncNotes */
function buildNarrativeCommitMessage(
  notes: SyncNote[],
  opts: { isFullResync: boolean; totalEvents?: number },
): string {
  if (opts.isFullResync) {
    const count = opts.totalEvents ?? notes.length;
    return `Sync calendar: full re-sync (token expired), ${count} events refreshed`;
  }

  const counts: Record<string, number> = {};
  for (const note of notes) {
    counts[note.action] = (counts[note.action] || 0) + 1;
  }

  const parts: string[] = [];
  if (counts["new"]) parts.push(`${counts["new"]} new`);
  if (counts["updated"]) parts.push(`${counts["updated"]} updated`);
  if (counts["deleted"]) parts.push(`${counts["deleted"]} deleted`);
  if (counts["pushed"]) parts.push(`${counts["pushed"]} pushed`);
  if (counts["cancelled"]) parts.push(`${counts["cancelled"]} cancelled`);

  let message = `Sync calendar: ${parts.join(", ")}`;

  // Group notes by action for the body
  const sections: Array<{ label: string; action: SyncNote["action"] }> = [
    { label: "New", action: "new" },
    { label: "Updated", action: "updated" },
    { label: "Pushed", action: "pushed" },
    { label: "Deleted", action: "deleted" },
    { label: "Cancelled", action: "cancelled" },
  ];

  const bodyParts: string[] = [];
  for (const { label, action } of sections) {
    const items = notes.filter((n) => n.action === action);
    if (items.length === 0) continue;
    const lines = items.map((n) => {
      let line = `- ${n.summary}`;
      if (n.detail) line += ` — ${n.detail}`;
      if (n.ref) line += ` [ref: ${n.ref}]`;
      return line;
    });
    bodyParts.push(`${label}:\n${lines.join("\n")}`);
  }

  if (bodyParts.length > 0) {
    message += `\n\n${bodyParts.join("\n\n")}`;
  }

  return message;
}

class GoogleCalendarConnector implements Connector {
  name = "google-calendar";
  produces = ["calendar-event"];
  triggeredBy?: string;

  private boxRoot: string;

  constructor(boxRoot: string) {
    this.boxRoot = boxRoot;
  }

  private statePath(): string {
    return path.join(
      this.boxRoot,
      "config/connectors/google-calendar-state.json"
    );
  }

  private calendarDir(): string {
    return path.join(this.boxRoot, "store/calendar");
  }

  private async loadConfig(): Promise<CalendarConfig> {
    return loadCalendarConfig(this.boxRoot);
  }

  private async loadState(): Promise<CalendarState> {
    let persistent: CalendarState;
    try {
      const content = await fs.readFile(this.statePath(), "utf-8");
      persistent = JSON.parse(content);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT" && !(err instanceof SyntaxError)) {
        throw err;
      }
      persistent = { syncTokens: {}, eventFiles: {} };
    }
    // Merge syncTokens from transient state (gitignored)
    const transient = await loadTransientState<CalendarTransientState>({
      boxRoot: this.boxRoot, connectorName: "google-calendar", defaultValue: { syncTokens: {} },
    });
    persistent.syncTokens = { ...persistent.syncTokens, ...transient.syncTokens };
    return persistent;
  }

  private async saveState(state: CalendarState): Promise<void> {
    // Save syncTokens to transient (gitignored), eventFiles to persistent (committed)
    await saveTransientState({
      boxRoot: this.boxRoot, connectorName: "google-calendar",
      data: { syncTokens: state.syncTokens },
    });
    const persistent = { syncTokens: {}, eventFiles: state.eventFiles };
    await fs.mkdir(path.dirname(this.statePath()), { recursive: true });
    await fs.writeFile(this.statePath(), JSON.stringify(persistent, null, 2));
  }

  async sync(): Promise<SyncResult> {
    const allowed = await isGoogleServiceAllowed(this.boxRoot, "calendar");
    if (!allowed) {
      return { success: true, created: [], updated: [] };
    }

    const auth = await getGoogleAuth(this.boxRoot);
    if (!auth) {
      return { success: true, created: [], updated: [] };
    }

    const config = await this.loadConfig();
    const state = await this.loadState();
    const calendars = config.calendars || ["primary"];
    const syncDaysBack = config.syncDaysBack ?? 30;
    const syncDaysForward = config.syncDaysForward ?? 90;

    // Fetch calendar metadata and cache names/roles
    const available = await fetchAvailableCalendars(auth);
    const calendarNames: Record<string, string> = {};
    const calendarRoles: Record<string, string> = {};
    for (const cal of available) {
      calendarNames[cal.id] = cal.summary;
      calendarRoles[cal.id] = cal.accessRole;
      if (cal.primary) {
        calendarNames["primary"] = cal.summary;
        calendarRoles["primary"] = cal.accessRole;
      }
    }
    await saveCalendarConfig(this.boxRoot, {
      ...config,
      calendarNames,
      calendarRoles,
    });

    const calDir = this.calendarDir();
    await fs.mkdir(calDir, { recursive: true });

    // Time window for client-side filtering (incremental sync can return
    // events outside our window, e.g. all instances of a recurring event)
    const now = new Date();
    const windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() - syncDaysBack);
    const windowEnd = new Date(now);
    windowEnd.setDate(windowEnd.getDate() + syncDaysForward);

    const created: string[] = [];
    const updated: string[] = [];
    const deleted: string[] = [];
    const allNotes: SyncNote[] = [];
    let isFullResync = false;

    for (const calendarId of calendars) {
      const existingSyncToken = state.syncTokens[calendarId];
      const icsOpts: { calendarId: string; calendarName?: string; calendarRole?: string } = { calendarId };
      if (calendarNames[calendarId]) icsOpts.calendarName = calendarNames[calendarId];
      if (calendarRoles[calendarId]) icsOpts.calendarRole = calendarRoles[calendarId];

      try {
        const result = await this.syncCalendar({
          auth, calendarId, syncToken: existingSyncToken,
          syncDaysBack, syncDaysForward, state, icsOpts, calDir,
          windowStart, windowEnd,
        });
        created.push(...result.created);
        updated.push(...result.updated);
        deleted.push(...result.deleted);
        allNotes.push(...result.notes);
      } catch (err) {
        const message = (err as Error).message;
        if (message.includes("410")) {
          console.log(
            `  Sync token expired for ${calendarId}, doing full sync...`
          );
          isFullResync = true;
          delete state.syncTokens[calendarId];
          await this.saveState(state);
          const result = await this.syncCalendar({
            auth, calendarId, syncToken: undefined,
            syncDaysBack, syncDaysForward, state, icsOpts, calDir,
            windowStart, windowEnd,
          });
          created.push(...result.created);
          updated.push(...result.updated);
          deleted.push(...result.deleted);
          // Don't add individual notes for full re-sync — the message will summarize
        } else {
          await this.saveState(state);
          return {
            success: false,
            created,
            updated,
            error: `Calendar sync failed for ${calendarId}: ${message}`,
          };
        }
      }
    }

    // Process locally-marked deletes (X-CB-DELETE property)
    const deleteResult = await this.processLocalDeletes({ auth, state, calDir });
    deleted.push(...deleteResult.deleted);
    allNotes.push(...deleteResult.notes);

    // Push locally-created files to Google, clean unparseable orphans
    const defaultCalendarId = calendars[0] || "primary";
    const orphanResult = await this.pushAndCleanOrphans(
      { auth, state, calDir, defaultCalendarId },
    );
    const pushed = orphanResult.pushed;
    deleted.push(...orphanResult.deleted);
    allNotes.push(...orphanResult.notes);

    await this.saveState(state);

    // Stage and commit
    const filesToStage = [
      path.relative(this.boxRoot, calDir),
      path.relative(this.boxRoot, this.statePath()),
      "config/connectors/google-calendar.json",
    ];
    await stageFiles(this.boxRoot, filesToStage);
    const allChanged = [...created, ...updated, ...deleted, ...pushed];
    if (allChanged.length > 0) {
      const message = buildNarrativeCommitMessage(allNotes, {
        isFullResync,
        totalEvents: allChanged.length,
      });
      await commit(this.boxRoot, {
        message,
        trailers: { "Pulled-By": "google-calendar-connector", ...(this.triggeredBy ? { "Triggered-By": this.triggeredBy } : {}) },
      });
    } else {
      // Only commit state update if there are actually staged changes
      // (syncToken may have changed even with no event changes)
      const status = await getStatus(this.boxRoot);
      if (status.staged.length > 0) {
        await commit(this.boxRoot, {
          message: "Sync calendar: no changes (token refreshed)",
          trailers: { "Pulled-By": "google-calendar-connector", ...(this.triggeredBy ? { "Triggered-By": this.triggeredBy } : {}) },
        });
      }
    }

    // Create calendar-review job if there are reviewable changes
    const jobs: string[] = [];
    const reviewableNotes = allNotes.filter(
      (n) => n.action === "new" || n.action === "updated" || n.action === "cancelled" || n.action === "deleted"
    );
    if (reviewableNotes.length > 0 && !isFullResync) {
      const jobPath = await this.createCalendarReviewJob(reviewableNotes);
      if (jobPath) jobs.push(jobPath);
    }

    const result: SyncResult = { success: true, created, updated };
    if (pushed.length > 0) result.pushed = pushed;
    if (jobs.length > 0) result.jobs = jobs;
    return result;
  }

  /**
   * Create a calendar-review job from sync notes.
   * Priority heuristic: if any event starts today or tomorrow, normal; otherwise low.
   */
  private async createCalendarReviewJob(notes: SyncNote[]): Promise<string | null> {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 2);
    tomorrow.setHours(0, 0, 0, 0);

    const hasUrgent = notes.some((n) => {
      if (!n.eventStart) return false;
      return n.eventStart <= tomorrow;
    });
    const priority = hasUrgent ? "normal" : "low";

    const changes: CalendarChangeInput[] = notes.map((n) => {
      const action = n.action === "cancelled" ? "deleted" : n.action;
      const change: CalendarChangeInput = {
        action: action as "new" | "updated" | "deleted",
        summary: n.summary + (n.detail ? ` — ${n.detail}` : ""),
      };
      if (n.ref) change.ref = n.ref;
      if (n.icsContent) change.icsContent = n.icsContent;
      return change;
    });

    const jobsDir = path.join(this.boxRoot, "box/jobs");
    await fs.mkdir(jobsDir, { recursive: true });

    const timestamp = getBoxTimeISO(this.boxRoot)
      .replace(/[.:]/g, "-")
      .slice(0, 19);
    const jobFilename = `${timestamp}.calendar-review.job.card`;
    const jobPath = path.join(jobsDir, jobFilename);
    const jobRelPath = path.relative(this.boxRoot, jobPath);

    const content = createCalendarReviewJobTemplate({
      created: getBoxTimeISO(this.boxRoot),
      source: "google-calendar",
      description: `${changes.length} calendar change${changes.length === 1 ? "" : "s"} to review`,
      changes,
      priority,
    });
    await fs.writeFile(jobPath, content);

    await stageFiles(this.boxRoot, [jobRelPath]);
    await commit(this.boxRoot, {
      message: "Create calendar-review job",
      trailers: { "Created-By": "google-calendar-connector", ...(this.triggeredBy ? { "Triggered-By": this.triggeredBy } : {}) },
    });

    return jobRelPath;
  }

  private async syncCalendar(opts: {
    auth: OAuth2Client;
    calendarId: string;
    syncToken: string | undefined;
    syncDaysBack: number;
    syncDaysForward: number;
    state: CalendarState;
    icsOpts: { calendarId: string; calendarName?: string; calendarRole?: string };
    calDir: string;
    windowStart: Date;
    windowEnd: Date;
  }): Promise<{ created: string[]; updated: string[]; deleted: string[]; notes: SyncNote[] }> {
    const { auth, calendarId, syncToken, syncDaysBack, syncDaysForward,
            state, icsOpts, calDir, windowStart, windowEnd } = opts;
    const created: string[] = [];
    const updated: string[] = [];
    const deleted: string[] = [];
    const notes: SyncNote[] = [];

    const events = await this.fetchEvents({
      auth, calendarId, syncToken, syncDaysBack, syncDaysForward, state,
    });

    for (const event of events) {
      // Skip exception instances (single-instance overrides of recurring events).
      // We only store the recurring master with its RRULE.
      if (event.recurringEventId) continue;

      if (event.status === "cancelled") {
        const existingEntry = state.eventFiles[event.id];
        if (existingEntry) {
          const oldName = getFilename(existingEntry);
          const filePath = path.join(calDir, oldName);
          try {
            // Capture ICS content before deleting for calendar-review job
            let icsContent: string | undefined;
            try {
              icsContent = await fs.readFile(filePath, "utf-8");
            } catch {
              // File already gone
            }
            await fs.unlink(filePath);
            deleted.push(path.relative(this.boxRoot, filePath));
            const note: SyncNote = {
              action: "cancelled",
              summary: event.summary || oldName,
            };
            if (icsContent) note.icsContent = icsContent;
            notes.push(note);
          } catch (err: unknown) {
            if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
          }
          delete state.eventFiles[event.id];
        }
        continue;
      }

      // Filter out events outside the sync window
      if (!isInWindow(event, { start: windowStart, end: windowEnd })) {
        continue;
      }

      const filename = eventFilename(event);
      const filePath = path.join(calDir, filename);
      const icsContent = eventToIcs(event, icsOpts);

      const existingEntry = state.eventFiles[event.id];
      const oldName = existingEntry ? getFilename(existingEntry) : undefined;
      if (oldName && oldName !== filename) {
        try {
          await fs.unlink(path.join(calDir, oldName));
          deleted.push(
            path.relative(this.boxRoot, path.join(calDir, oldName))
          );
        } catch (err: unknown) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
      }

      const relPath = path.relative(this.boxRoot, filePath);
      const eventStart = parseEventStart(event);

      // Check for local edits before overwriting
      if (existingEntry) {
        const storedHash = typeof existingEntry === "string" ? undefined : existingEntry.contentHash;
        let localContent: string | undefined;
        try {
          localContent = await fs.readFile(
            path.join(calDir, oldName || filename), "utf-8"
          );
        } catch {
          // File missing — proceed with write
        }

        if (localContent && storedHash && contentHash(localContent) !== storedHash) {
          // Local file was edited — push local changes to Google instead of overwriting
          const localEvent = icsToGoogleEvent(localContent);
          if (localEvent) {
            const entryCalId = typeof existingEntry === "string" ? icsOpts.calendarId : existingEntry.calendarId;
            delete localEvent._calendarId;
            const patchResult = await this.patchEvent(auth, {
              calendarId: entryCalId,
              googleEventId: event.id,
              event: localEvent,
            });
            if (patchResult) {
              // Patch succeeded — rewrite file from Google's response to normalize
              const patchedIcs = eventToIcs(patchResult, icsOpts);
              await fs.writeFile(filePath, patchedIcs);
              state.eventFiles[event.id] = { filename, calendarId: icsOpts.calendarId, contentHash: contentHash(patchedIcs) };
              updated.push(relPath);
              const note: SyncNote = {
                action: "pushed",
                summary: `${localEvent.summary || filename} (local edit pushed)`,
                ref: relPath,
              };
              if (eventStart) note.eventStart = eventStart;
              notes.push(note);
              continue;
            }
            // Patch failed — fall through to overwrite with Google's version
            console.warn(`  Failed to push local edit for ${filename}, overwriting with Google version`);
          }
        }

        // Normal update path: diff old vs new content for update notes
        if (localContent) {
          const changes = describeChanges(localContent, icsContent);
          if (changes.length > 0) {
            const note: SyncNote = {
              action: "updated",
              summary: event.summary || filename,
              detail: changes.join(", "),
              ref: relPath,
            };
            if (eventStart) note.eventStart = eventStart;
            notes.push(note);
          }
          // If no visible changes, skip the note (just metadata refresh)
        } else {
          const note: SyncNote = {
            action: "updated",
            summary: event.summary || filename,
            ref: relPath,
          };
          if (eventStart) note.eventStart = eventStart;
          notes.push(note);
        }
      } else {
        // New event from Google
        const dateStr = formatEventDate(event);
        const calLabel = icsOpts.calendarName && calendarId !== "primary"
          ? `, ${icsOpts.calendarName}` : "";
        const note: SyncNote = {
          action: "new",
          summary: `${event.summary || "(no title)"}${dateStr ? ` (${dateStr}${calLabel})` : ""}`,
          ref: relPath,
        };
        if (eventStart) note.eventStart = eventStart;
        notes.push(note);
      }

      await fs.writeFile(filePath, icsContent);

      if (existingEntry) {
        updated.push(relPath);
      } else {
        created.push(relPath);
      }

      state.eventFiles[event.id] = { filename, calendarId: icsOpts.calendarId, contentHash: contentHash(icsContent) };
    }

    return { created, updated, deleted, notes };
  }

  /**
   * Push locally-created .ics files (not tracked in state) to Google Calendar,
   * then track them. Returns { pushed, deleted, notes } arrays.
   */
  private async pushAndCleanOrphans(
    opts: { auth: OAuth2Client; state: CalendarState; calDir: string; defaultCalendarId: string },
  ): Promise<{ pushed: string[]; deleted: string[]; notes: SyncNote[] }> {
    const { auth, state, calDir, defaultCalendarId } = opts;
    const pushed: string[] = [];
    const deleted: string[] = [];
    const notes: SyncNote[] = [];
    const trackedFiles = new Set<string>();
    for (const entry of Object.values(state.eventFiles)) {
      trackedFiles.add(getFilename(entry));
    }

    let files: string[];
    try {
      files = await fs.readdir(calDir);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      return { pushed, deleted, notes };
    }

    for (const file of files) {
      if (!file.endsWith(".ics")) continue;
      if (trackedFiles.has(file)) continue;

      const filePath = path.join(calDir, file);
      const relPath = path.relative(this.boxRoot, filePath);

      try {
        const content = await fs.readFile(filePath, "utf-8");
        const apiEvent = icsToGoogleEvent(content);
        if (!apiEvent) {
          // Unparseable — delete orphan
          await fs.unlink(filePath);
          deleted.push(relPath);
          continue;
        }

        // Validate timezone on non-all-day events
        const tzError = validateIcsTimezone(content);
        if (tzError) {
          console.warn(`  Skipping ${file}: ${tzError}`);
          continue;
        }

        // Extract and strip annotations before pushing
        const { reason, ref, stripped } = extractCbAnnotations(content);

        // Determine target calendar from X-CB-CALENDAR-ID or use default
        const calendarId = apiEvent._calendarId || defaultCalendarId;
        // Remove our internal field before sending to API
        delete apiEvent._calendarId;

        const result = await this.insertEvent(auth, { calendarId, event: apiEvent });
        if (result) {
          // Track the file with its new Google event ID
          state.eventFiles[result.id] = { filename: file, calendarId };
          pushed.push(relPath);

          // Write back stripped content (without annotations)
          if (reason || ref) {
            await fs.writeFile(filePath, stripped);
          }

          // Build push note
          const dateStr = formatEventDate(apiEvent);
          const pushNote: SyncNote = {
            action: "pushed",
            summary: `${apiEvent.summary || file}${dateStr ? ` (${dateStr})` : ""}`,
          };
          if (reason) pushNote.detail = reason;
          if (ref) pushNote.ref = ref;
          notes.push(pushNote);
        } else {
          // Push failed — leave the file alone (don't delete it)
          console.warn(`  Failed to push ${file}, keeping locally`);
        }
      } catch (err: unknown) {
        console.warn(`  Error processing ${file}:`, err);
      }
    }

    return { pushed, deleted, notes };
  }

  /**
   * Scan tracked .ics files for X-CB-DELETE property. If found, delete the
   * event from Google Calendar, remove the local file, and untrack it.
   * Safety cap: at most 3 deletes per sync. Skips read-only calendars.
   */
  private async processLocalDeletes(
    opts: { auth: OAuth2Client; state: CalendarState; calDir: string },
  ): Promise<{ deleted: string[]; notes: SyncNote[] }> {
    const { auth, state, calDir } = opts;
    const deleted: string[] = [];
    const notes: SyncNote[] = [];
    const MAX_DELETES = 3;

    for (const [googleEventId, entry] of Object.entries(state.eventFiles)) {
      const filename = getFilename(entry);
      const calendarId = typeof entry === "string" ? undefined : entry.calendarId;
      const filePath = path.join(calDir, filename);

      let content: string;
      try {
        content = await fs.readFile(filePath, "utf-8");
      } catch {
        continue; // File missing — not a delete request
      }

      // Check for X-CB-DELETE property
      const deleteMatch = content.match(/^x-cb-delete[:;](.*)$/im);
      if (!deleteMatch) continue;

      const reason = deleteMatch[1]?.trim() || "(no reason)";

      // Extract event summary for the commit message
      const summaryMatch = content.match(/^summary[:;](.*)$/im);
      const summary = summaryMatch?.[1]?.trim() || filename;

      // Extract optional X-CB-REF
      const refMatch = content.match(/^x-cb-ref[:;](.*)$/im);
      const ref = refMatch?.[1]?.trim();

      if (deleted.length >= MAX_DELETES) {
        console.warn(`  Skipping delete of ${filename} — reached limit of ${MAX_DELETES} deletes per sync`);
        continue;
      }

      if (!calendarId) {
        console.warn(`  Skipping delete of ${filename} — no calendar ID in state`);
        continue;
      }

      console.log(`  Deleting ${filename}: ${reason}`);
      // Capture ICS content before deleting for calendar-review job
      let icsContent: string | undefined;
      try {
        icsContent = await fs.readFile(filePath, "utf-8");
      } catch {
        // File already gone
      }
      const success = await this.deleteEvent(auth, { calendarId, googleEventId });
      if (success) {
        await fs.unlink(filePath);
        delete state.eventFiles[googleEventId];
        deleted.push(path.relative(this.boxRoot, filePath));
        const deleteNote: SyncNote = { action: "deleted", summary, detail: reason };
        if (icsContent) deleteNote.icsContent = icsContent;
        if (ref) deleteNote.ref = ref;
        notes.push(deleteNote);
      } else {
        console.warn(`  Failed to delete ${filename} from Google Calendar`);
      }
    }

    return { deleted, notes };
  }

  /**
   * Delete an event from Google Calendar via the REST API.
   */
  private async deleteEvent(
    auth: OAuth2Client,
    opts: { calendarId: string; googleEventId: string },
  ): Promise<boolean> {
    const { calendarId, googleEventId } = opts;
    const accessToken = (await auth.getAccessToken()).token;

    try {
      await ky.delete(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          retry: 2,
        },
      );
      return true;
    } catch (err) {
      const status = (err as HTTPError).response?.status;
      if (status === 410) return true; // Already gone
      if (status) {
        const text = await (err as HTTPError).response.text();
        console.warn(`  API error deleting from ${calendarId}: ${status} ${text}`);
        return false;
      }
      throw err;
    }
  }

  /**
   * Insert an event into Google Calendar via the REST API.
   * Returns the created event or null on failure.
   */
  private async insertEvent(
    auth: OAuth2Client,
    opts: { calendarId: string; event: GoogleCalendarEvent },
  ): Promise<GoogleCalendarEvent | null> {
    const { calendarId, event } = opts;
    const accessToken = (await auth.getAccessToken()).token;

    try {
      return await ky
        .post(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
          {
            json: event,
            headers: { Authorization: `Bearer ${accessToken}` },
            retry: 2,
          },
        )
        .json<GoogleCalendarEvent>();
    } catch (err) {
      const status = (err as HTTPError).response?.status;
      if (status) {
        const text = await (err as HTTPError).response.text();
        console.warn(`  API error pushing to ${calendarId}: ${status} ${text}`);
        return null;
      }
      throw err;
    }
  }

  /**
   * Update an existing event in Google Calendar via the REST API (PATCH).
   * Returns the updated event or null on failure.
   */
  private async patchEvent(
    auth: OAuth2Client,
    opts: { calendarId: string; googleEventId: string; event: GoogleCalendarEvent },
  ): Promise<GoogleCalendarEvent | null> {
    const { calendarId, googleEventId, event } = opts;
    const accessToken = (await auth.getAccessToken()).token;

    try {
      return await ky
        .patch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
          {
            json: event,
            headers: { Authorization: `Bearer ${accessToken}` },
            retry: 2,
          },
        )
        .json<GoogleCalendarEvent>();
    } catch (err) {
      const status = (err as HTTPError).response?.status;
      if (status) {
        const text = await (err as HTTPError).response.text();
        console.warn(`  API error patching in ${calendarId}: ${status} ${text}`);
        return null;
      }
      throw err;
    }
  }

  private async fetchEvents(
    opts: { auth: OAuth2Client; calendarId: string; syncToken: string | undefined; syncDaysBack: number; syncDaysForward: number; state: CalendarState },
  ): Promise<GoogleCalendarEvent[]> {
    const { auth, calendarId, syncToken, syncDaysBack, syncDaysForward, state } = opts;
    const allEvents: GoogleCalendarEvent[] = [];
    let pageToken: string | undefined;

    do {
      const searchParams: Record<string, string> = {
        singleEvents: "false",
        maxResults: "2500",
      };

      if (syncToken) {
        searchParams["syncToken"] = syncToken;
      } else {
        // Full sync: use time window to limit results
        const now = new Date();
        const timeMin = new Date(now);
        timeMin.setDate(timeMin.getDate() - syncDaysBack);
        const timeMax = new Date(now);
        timeMax.setDate(timeMax.getDate() + syncDaysForward);
        searchParams["timeMin"] = timeMin.toISOString();
        searchParams["timeMax"] = timeMax.toISOString();
      }

      if (pageToken) {
        searchParams["pageToken"] = pageToken;
      }

      const accessToken = (await auth.getAccessToken()).token;
      const data = await ky
        .get(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
          {
            searchParams,
            headers: { Authorization: `Bearer ${accessToken}` },
            retry: 2,
          },
        )
        .json<GoogleCalendarListResponse>();

      if (data.items) {
        allEvents.push(...data.items);
      }

      pageToken = data.nextPageToken;

      if (data.nextSyncToken) {
        state.syncTokens[calendarId] = data.nextSyncToken;
      }
    } while (pageToken);

    return allEvents;
  }

}

export function createGoogleCalendarConnector(boxRoot: string): Connector {
  const connector = new GoogleCalendarConnector(boxRoot);
  registerConnector(connector);
  return connector;
}
