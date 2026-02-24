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

import * as fs from "node:fs/promises";
import * as path from "node:path";
// eslint-disable-next-line import-x/no-rename-default
import ICAL from "ical.js";
import type { OAuth2Client } from "google-auth-library";
import {
  registerConnector,
  type Connector,
  type SyncResult,
} from "./index.js";
import { getGoogleAuth } from "./google-auth.js";
import {
  loadCalendarConfig,
  saveCalendarConfig,
  fetchAvailableCalendars,
  type CalendarConfig,
} from "./calendar-config.js";
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

function eventToIcs(
  event: GoogleCalendarEvent,
  opts: { calendarId: string; calendarName?: string; calendarRole?: string },
): string {
  const { calendarId, calendarName, calendarRole } = opts;
  const comp = new ICAL.Component(["vcalendar", [], []]);
  comp.updatePropertyWithValue("prodid", "-//Callback Box//EN");
  comp.updatePropertyWithValue("version", "2.0");

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
      const dt = ICAL.Time.fromJSDate(new Date(event.start.dateTime), false);
      vevent.updatePropertyWithValue("dtstart", dt);
    } else if (event.start.date) {
      const dt = ICAL.Time.fromDateString(event.start.date);
      const prop = vevent.updatePropertyWithValue("dtstart", dt);
      prop.setParameter("value", "DATE");
    }
  }

  // End time
  if (event.end) {
    if (event.end.dateTime) {
      const dt = ICAL.Time.fromJSDate(new Date(event.end.dateTime), false);
      vevent.updatePropertyWithValue("dtend", dt);
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
    const dtstart = vevent.getFirstPropertyValue("dtstart") as ICAL.Time | null;
    if (dtstart) {
      if (dtstart.isDate) {
        result.start = { date: dtstart.toString() };
      } else {
        result.start = { dateTime: dtstart.toJSDate().toISOString() };
      }
    }

    // End time
    const dtend = vevent.getFirstPropertyValue("dtend") as ICAL.Time | null;
    if (dtend) {
      if (dtend.isDate) {
        result.end = { date: dtend.toString() };
      } else {
        result.end = { dateTime: dtend.toJSDate().toISOString() };
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

      // Diff old vs new content for update notes
      if (existingEntry) {
        try {
          const oldContent = await fs.readFile(
            path.join(calDir, oldName || filename), "utf-8"
          );
          const changes = describeChanges(oldContent, icsContent);
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
        } catch {
          // Old file unreadable — treat as simple update
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

      state.eventFiles[event.id] = { filename, calendarId: icsOpts.calendarId };
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
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`;
    const accessToken = (await auth.getAccessToken()).token;
    const response = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (response.status === 204 || response.status === 410) {
      return true; // Deleted or already gone
    }

    if (!response.ok) {
      const text = await response.text();
      console.warn(`  API error deleting from ${calendarId}: ${response.status} ${text}`);
      return false;
    }

    return true;
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
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
    const accessToken = (await auth.getAccessToken()).token;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    });

    if (!response.ok) {
      const text = await response.text();
      console.warn(`  API error pushing to ${calendarId}: ${response.status} ${text}`);
      return null;
    }

    return (await response.json()) as GoogleCalendarEvent;
  }

  private async fetchEvents(
    opts: { auth: OAuth2Client; calendarId: string; syncToken: string | undefined; syncDaysBack: number; syncDaysForward: number; state: CalendarState },
  ): Promise<GoogleCalendarEvent[]> {
    const { auth, calendarId, syncToken, syncDaysBack, syncDaysForward, state } = opts;
    const allEvents: GoogleCalendarEvent[] = [];
    let pageToken: string | undefined;

    do {
      const url = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
      );

      if (syncToken) {
        url.searchParams.set("syncToken", syncToken);
      } else {
        // Full sync: use time window to limit results
        const now = new Date();
        const timeMin = new Date(now);
        timeMin.setDate(timeMin.getDate() - syncDaysBack);
        const timeMax = new Date(now);
        timeMax.setDate(timeMax.getDate() + syncDaysForward);
        url.searchParams.set("timeMin", timeMin.toISOString());
        url.searchParams.set("timeMax", timeMax.toISOString());
      }

      url.searchParams.set("singleEvents", "false");
      url.searchParams.set("maxResults", "2500");
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }

      const accessToken = (await auth.getAccessToken()).token;
      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        throw new Error(
          `${response.status} ${response.statusText}: ${await response.text()}`
        );
      }

      const data = (await response.json()) as GoogleCalendarListResponse;

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
