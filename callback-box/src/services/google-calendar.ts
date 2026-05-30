/**
 * Google Calendar service — typed interface for the Calendar API operations we use.
 *
 * Real implementation calls the REST API with an access token from GoogleAuthService.
 * Fake maintains in-memory events.
 */

import ky, { type HTTPError } from "ky";
import type { GoogleAuthService } from "./google-auth.js";
import { NotFoundError } from "../lib/errors.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CalendarListEntry {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  accessRole: string;
  backgroundColor?: string;
}

export interface CalendarEvent {
  id: string;
  status: "confirmed" | "tentative" | "cancelled";
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
    responseStatus?: "accepted" | "declined" | "tentative" | "needsAction";
  }>;
  iCalUID?: string;
  transparency?: "opaque" | "transparent";
}

export interface EventsListResult {
  items: CalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

// ─── Service interface ───────────────────────────────────────────────────────

export interface GoogleCalendarService {
  listCalendars(): Promise<CalendarListEntry[]>;
  listEvents(calendarId: string, opts?: {
    syncToken?: string;
    timeMin?: string;
    timeMax?: string;
    pageToken?: string;
  }): Promise<EventsListResult>;
  insertEvent(calendarId: string, event: Partial<CalendarEvent>): Promise<CalendarEvent>;
  patchEvent(calendarId: string, opts: { eventId: string; event: Partial<CalendarEvent> }): Promise<CalendarEvent>;
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
}

// ─── Real implementation ─────────────────────────────────────────────────────

export function createGoogleCalendarService(auth: GoogleAuthService): GoogleCalendarService {
  const api = ky.create({
    prefixUrl: "https://www.googleapis.com/calendar/v3",
    retry: 2,
    hooks: {
      beforeRequest: [
        async (request) => {
          const token = await auth.getAccessToken();
          request.headers.set("Authorization", `Bearer ${token}`);
        },
      ],
    },
  });

  return {
    async listCalendars() {
      const items: CalendarListEntry[] = [];
      let pageToken: string | undefined;
      do {
        const searchParams: Record<string, string> = {};
        if (pageToken) searchParams["pageToken"] = pageToken;
        const data = await api
          .get("users/me/calendarList", { searchParams })
          .json<{ items?: CalendarListEntry[]; nextPageToken?: string }>();
        if (data.items) items.push(...data.items);
        pageToken = data.nextPageToken;
      } while (pageToken);
      return items;
    },

    async listEvents(calendarId, opts) {
      const searchParams: Record<string, string> = {
        singleEvents: "false",
        maxResults: "2500",
      };
      if (opts?.syncToken) {
        searchParams["syncToken"] = opts.syncToken;
      } else {
        if (opts?.timeMin) searchParams["timeMin"] = opts.timeMin;
        if (opts?.timeMax) searchParams["timeMax"] = opts.timeMax;
      }
      if (opts?.pageToken) searchParams["pageToken"] = opts.pageToken;

      return api
        .get(`calendars/${encodeURIComponent(calendarId)}/events`, { searchParams })
        .json<EventsListResult>();
    },

    async insertEvent(calendarId, event) {
      return api
        .post(`calendars/${encodeURIComponent(calendarId)}/events`, { json: event })
        .json<CalendarEvent>();
    },

    async patchEvent(calendarId, { eventId, event }) {
      return api
        .patch(
          `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
          { json: event },
        )
        .json<CalendarEvent>();
    },

    async deleteEvent(calendarId, eventId) {
      try {
        await api.delete(
          `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        );
      } catch (err) {
        // 410 Gone means already deleted — not an error
        if ((err as HTTPError).response?.status === 410) return;
        throw err as Error;
      }
    },
  };
}

// ─── Fake implementation ─────────────────────────────────────────────────────

export interface FakeGoogleCalendarOptions {
  calendars?: CalendarListEntry[];
  events?: CalendarEvent[];
}

export interface FakeGoogleCalendarService extends GoogleCalendarService {
  calendars: CalendarListEntry[];
  events: CalendarEvent[];
  describe(): string;
}

export function createFakeGoogleCalendar(
  opts?: FakeGoogleCalendarOptions,
): FakeGoogleCalendarService {
  let nextId = 1;

  const fake: FakeGoogleCalendarService = {
    calendars: [...(opts?.calendars ?? [])],
    events: [...(opts?.events ?? [])],

    async listCalendars() {
      return fake.calendars;
    },

    async listEvents(_calendarId, _opts) {
      return { items: fake.events, nextSyncToken: "fake-sync-token" };
    },

    async insertEvent(_calendarId, event) {
      const full: CalendarEvent = {
        id: `evt-${nextId++}`,
        status: "confirmed",
        ...event,
      } as CalendarEvent;
      fake.events.push(full);
      return full;
    },

    async patchEvent(_calendarId, { eventId, event }) {
      const idx = fake.events.findIndex((e) => e.id === eventId);
      if (idx === -1) {
        throw new NotFoundError(eventId, "Calendar event");
      }
      const merged: CalendarEvent = { ...fake.events[idx]!, ...event } as CalendarEvent;
      fake.events[idx] = merged;
      return merged;
    },

    async deleteEvent(_calendarId, eventId) {
      fake.events = fake.events.filter((e) => e.id !== eventId);
    },

    describe() {
      const lines: string[] = [];
      lines.push(`calendars (${fake.calendars.length}):`);
      for (const c of fake.calendars) {
        lines.push(`  - ${c.id}: ${c.summary}${c.primary ? " [primary]" : ""}`);
      }
      lines.push(`events (${fake.events.length}):`);
      for (const e of fake.events) {
        const when = e.start?.dateTime || e.start?.date || "(no date)";
        lines.push(`  - ${e.id} [${e.status}] ${e.summary || "(no title)"} @ ${when}`);
      }
      return lines.join("\n");
    },
  };

  return fake;
}
