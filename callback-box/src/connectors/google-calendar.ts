/**
 * Google Calendar Connector — Syncs calendar events as .ics files.
 *
 * Configuration:
 *   config/connectors/google-calendar.json       - { "calendars": ["primary"], "syncDaysBack": 30, "syncDaysForward": 90 }
 *   config/connectors/google-calendar-state.json  - { syncTokens, eventFiles }
 *   config/connectors/google.secret.json          - shared Google OAuth2 credentials
 *
 * Events are stored as individual .ics files in store/calendar/.
 * Filename format: {Slugged_Summary}_{YYYY-MM-DD}_{shortId}.ics
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import ICAL from "ical.js";
import type { OAuth2Client } from "google-auth-library";
import {
  registerConnector,
  type Connector,
  type PullResult,
  type ExecuteResult,
} from "./index.js";
import { getGoogleAuth } from "./google-auth.js";
import { stageFiles, commit } from "../cli/lib/git.js";

interface CalendarConfig {
  calendars?: string[];
  syncDaysBack?: number;
  syncDaysForward?: number;
}

interface CalendarState {
  /** syncToken per calendar ID */
  syncTokens: Record<string, string>;
  /** Google event ID → local filename mapping */
  eventFiles: Record<string, string>;
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
}

interface GoogleCalendarListResponse {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

function slugify(text: string): string {
  return text
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 40);
}

function eventToIcs(event: GoogleCalendarEvent): string {
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

  return comp.toString();
}

function eventFilename(event: GoogleCalendarEvent): string {
  const summary = event.summary || "untitled";
  const slug = slugify(summary);
  const dateStr =
    event.start?.dateTime?.slice(0, 10) ||
    event.start?.date ||
    "no-date";
  const shortId = event.id.slice(-8);
  return `${slug}_${dateStr}_${shortId}.ics`;
}

class GoogleCalendarConnector implements Connector {
  name = "google-calendar";
  handles: string[] = [];
  produces = ["calendar-event"];

  private boxRoot: string;

  constructor(boxRoot: string) {
    this.boxRoot = boxRoot;
  }

  private configPath(): string {
    return path.join(this.boxRoot, "config/connectors/google-calendar.json");
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
    try {
      const content = await fs.readFile(this.configPath(), "utf-8");
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  private async loadState(): Promise<CalendarState> {
    try {
      const content = await fs.readFile(this.statePath(), "utf-8");
      return JSON.parse(content);
    } catch {
      return { syncTokens: {}, eventFiles: {} };
    }
  }

  private async saveState(state: CalendarState): Promise<void> {
    await fs.mkdir(path.dirname(this.statePath()), { recursive: true });
    await fs.writeFile(this.statePath(), JSON.stringify(state, null, 2));
  }

  async pull(): Promise<PullResult> {
    const auth = await getGoogleAuth(this.boxRoot);
    if (!auth) {
      return { success: true, created: [], updated: [] };
    }

    const config = await this.loadConfig();
    const state = await this.loadState();
    const calendars = config.calendars || ["primary"];
    const syncDaysBack = config.syncDaysBack ?? 30;
    const syncDaysForward = config.syncDaysForward ?? 90;

    const calDir = this.calendarDir();
    await fs.mkdir(calDir, { recursive: true });

    const created: string[] = [];
    const updated: string[] = [];
    const deleted: string[] = [];

    for (const calendarId of calendars) {
      const existingSyncToken = state.syncTokens[calendarId];

      try {
        const events = await this.fetchEvents({
          auth,
          calendarId,
          syncToken: existingSyncToken,
          syncDaysBack,
          syncDaysForward,
          state,
        });

        for (const event of events) {
          if (event.status === "cancelled") {
            // Remove the .ics file if it exists
            const existingFile = state.eventFiles[event.id];
            if (existingFile) {
              const filePath = path.join(calDir, existingFile);
              try {
                await fs.unlink(filePath);
                deleted.push(path.relative(this.boxRoot, filePath));
              } catch {
                // File already gone
              }
              delete state.eventFiles[event.id];
            }
            continue;
          }

          const filename = eventFilename(event);
          const filePath = path.join(calDir, filename);
          const icsContent = eventToIcs(event);

          // Check if this is an update (different filename) or new
          const oldFile = state.eventFiles[event.id];
          if (oldFile && oldFile !== filename) {
            // Remove old file
            try {
              await fs.unlink(path.join(calDir, oldFile));
              deleted.push(
                path.relative(this.boxRoot, path.join(calDir, oldFile))
              );
            } catch {
              // Old file already gone
            }
          }

          await fs.writeFile(filePath, icsContent);
          const relPath = path.relative(this.boxRoot, filePath);

          if (oldFile) {
            updated.push(relPath);
          } else {
            created.push(relPath);
          }

          state.eventFiles[event.id] = filename;
        }
      } catch (err) {
        const message = (err as Error).message;
        // On 410 Gone, clear sync token and retry with full sync
        if (message.includes("410")) {
          console.log(
            `  Sync token expired for ${calendarId}, doing full sync...`
          );
          delete state.syncTokens[calendarId];
          await this.saveState(state);
          // Retry this calendar
          const events = await this.fetchEvents({
            auth,
            calendarId,
            syncToken: undefined,
            syncDaysBack,
            syncDaysForward,
            state,
          });
          for (const event of events) {
            if (event.status === "cancelled") continue;
            const filename = eventFilename(event);
            const filePath = path.join(calDir, filename);
            await fs.writeFile(filePath, eventToIcs(event));
            const relPath = path.relative(this.boxRoot, filePath);
            if (state.eventFiles[event.id]) {
              updated.push(relPath);
            } else {
              created.push(relPath);
            }
            state.eventFiles[event.id] = filename;
          }
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

    await this.saveState(state);

    // Stage and commit if there are changes
    const allChanged = [...created, ...updated, ...deleted];
    if (allChanged.length > 0) {
      // Stage the calendar directory (handles additions, modifications, deletions)
      await stageFiles(this.boxRoot, [
        path.relative(this.boxRoot, calDir),
      ]);
      await commit(this.boxRoot, {
        message: `Pull ${created.length} new, ${updated.length} updated, ${deleted.length} deleted calendar events`,
        trailers: { "Pulled-By": "google-calendar-connector" },
      });
    }

    return { success: true, created, updated };
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
        // Full sync with time window
        const now = new Date();
        const timeMin = new Date(now);
        timeMin.setDate(timeMin.getDate() - syncDaysBack);
        const timeMax = new Date(now);
        timeMax.setDate(timeMax.getDate() + syncDaysForward);
        url.searchParams.set("timeMin", timeMin.toISOString());
        url.searchParams.set("timeMax", timeMax.toISOString());
      }

      url.searchParams.set("singleEvents", "true");
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

      // Save sync token when we get the final page
      if (data.nextSyncToken) {
        state.syncTokens[calendarId] = data.nextSyncToken;
      }
    } while (pageToken);

    return allEvents;
  }

  async execute(_cardPath: string, _dryRun: boolean): Promise<ExecuteResult> {
    return {
      success: false,
      error: "Google Calendar connector does not support command execution yet",
    };
  }
}

export function createGoogleCalendarConnector(boxRoot: string): Connector {
  const connector = new GoogleCalendarConnector(boxRoot);
  registerConnector(connector);
  return connector;
}
