/**
 * Google Calendar connector state + API wrappers.
 *
 * Owns the on-disk sync state (syncTokens in gitignored transient state,
 * eventFiles in committed persistent state) and the thin Google Calendar API
 * call wrappers that translate HTTP errors into null/false results. Leaf
 * module: depends only on fs, the calendar service, and transient-state.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { HTTPError } from "ky";
import { type GoogleCalendarService } from "../services/google-calendar.js";
import { loadTransientState, saveTransientState } from "./transient-state.js";
import { type GoogleCalendarEvent } from "./google-calendar-ics.js";

interface CalendarTransientState {
  syncTokens: Record<string, string>;
}

export interface EventFileEntry {
  filename: string;
  calendarId: string;
  /** Hash of the ICS content last written by the connector (for detecting local edits) */
  contentHash?: string;
  /** Google event `updated` timestamp captured at the last pull, for remote-change detection */
  remoteUpdated?: string | undefined;
}

export interface CalendarState {
  /** syncToken per calendar ID */
  syncTokens: Record<string, string>;
  /** Google event ID → file info (or legacy plain filename string) */
  eventFiles: Record<string, string | EventFileEntry>;
}

/** Get filename from eventFiles entry (handles legacy string format) */
export function getFilename(entry: string | EventFileEntry): string {
  return typeof entry === "string" ? entry : entry.filename;
}

/** Short content hash for detecting local edits to .ics files */
export function contentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function calendarStatePath(boxRoot: string): string {
  return path.join(boxRoot, "config/connectors/google-calendar-state.json");
}

export function calendarDir(boxRoot: string): string {
  return path.join(boxRoot, "store/calendar");
}

export async function loadCalendarState(boxRoot: string): Promise<CalendarState> {
  let persistent: CalendarState;
  try {
    const content = await fs.readFile(calendarStatePath(boxRoot), "utf-8");
    persistent = JSON.parse(content);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT" && !(err instanceof SyntaxError)) {
      throw err;
    }
    persistent = { syncTokens: {}, eventFiles: {} };
  }
  // Merge syncTokens from transient state (gitignored)
  const transient = await loadTransientState<CalendarTransientState>({
    boxRoot, connectorName: "google-calendar", defaultValue: { syncTokens: {} },
  });
  persistent.syncTokens = { ...persistent.syncTokens, ...transient.syncTokens };
  return persistent;
}

export async function saveCalendarState(boxRoot: string, state: CalendarState): Promise<void> {
  // Save syncTokens to transient (gitignored), eventFiles to persistent (committed)
  await saveTransientState({
    boxRoot, connectorName: "google-calendar",
    data: { syncTokens: state.syncTokens },
  });
  const persistent = { syncTokens: {}, eventFiles: state.eventFiles };
  await fs.mkdir(path.dirname(calendarStatePath(boxRoot)), { recursive: true });
  await fs.writeFile(calendarStatePath(boxRoot), JSON.stringify(persistent, null, 2));
}

/** Delete an event via the calendar service. Returns false on HTTP errors. */
export async function deleteEventViaApi(
  calendar: GoogleCalendarService,
  opts: { calendarId: string; googleEventId: string },
): Promise<boolean> {
  const { calendarId, googleEventId } = opts;
  try {
    await calendar.deleteEvent(calendarId, googleEventId);
    return true;
  } catch (err) {
    if (err instanceof HTTPError) {
      const status = err.response?.status;
      const text = await err.response.text();
      console.warn(`  API error deleting from ${calendarId}: ${status} ${text}`);
      return false;
    }
    throw err;
  }
}

/** Insert an event via the calendar service. Returns null on HTTP errors. */
export async function insertEventViaApi(
  calendar: GoogleCalendarService,
  opts: { calendarId: string; event: GoogleCalendarEvent },
): Promise<GoogleCalendarEvent | null> {
  const { calendarId, event } = opts;
  try {
    return await calendar.insertEvent(calendarId, event);
  } catch (err) {
    if (err instanceof HTTPError) {
      const status = err.response?.status;
      const text = await err.response.text();
      console.warn(`  API error pushing to ${calendarId}: ${status} ${text}`);
      return null;
    }
    throw err;
  }
}

/** Patch an event via the calendar service. Returns null on HTTP errors. */
export async function patchEventViaApi(
  calendar: GoogleCalendarService,
  opts: { calendarId: string; googleEventId: string; event: GoogleCalendarEvent },
): Promise<GoogleCalendarEvent | null> {
  const { calendarId, googleEventId, event } = opts;
  try {
    return await calendar.patchEvent(calendarId, { eventId: googleEventId, event });
  } catch (err) {
    if (err instanceof HTTPError) {
      const status = err.response?.status;
      const text = await err.response.text();
      console.warn(`  API error patching in ${calendarId}: ${status} ${text}`);
      return null;
    }
    throw err;
  }
}

export async function fetchEvents(
  opts: { calendar: GoogleCalendarService; calendarId: string; syncToken: string | undefined; syncDaysBack: number; syncDaysForward: number; state: CalendarState },
): Promise<GoogleCalendarEvent[]> {
  const { calendar, calendarId, syncToken, syncDaysBack, syncDaysForward, state } = opts;
  const allEvents: GoogleCalendarEvent[] = [];
  let pageToken: string | undefined;

  // Compute time window for full sync (ignored when syncToken is set)
  const now = new Date();
  const timeMin = new Date(now);
  timeMin.setDate(timeMin.getDate() - syncDaysBack);
  const timeMax = new Date(now);
  timeMax.setDate(timeMax.getDate() + syncDaysForward);

  do {
    const listOpts: { syncToken?: string; timeMin?: string; timeMax?: string; pageToken?: string } = {};
    if (syncToken) {
      listOpts.syncToken = syncToken;
    } else {
      listOpts.timeMin = timeMin.toISOString();
      listOpts.timeMax = timeMax.toISOString();
    }
    if (pageToken) listOpts.pageToken = pageToken;

    const data = await calendar.listEvents(calendarId, listOpts);
    if (data.items) allEvents.push(...data.items);
    pageToken = data.nextPageToken;
    if (data.nextSyncToken) {
      state.syncTokens[calendarId] = data.nextSyncToken;
    }
  } while (pageToken);

  return allEvents;
}
