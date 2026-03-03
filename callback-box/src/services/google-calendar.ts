/**
 * Google Calendar service — typed interface for the Calendar API operations we use.
 *
 * Real implementation calls the REST API with an access token from GoogleAuthService.
 * Fake maintains in-memory events.
 */

import type { GoogleAuthService } from "./google-auth.js";

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
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
}

// ─── Real implementation ─────────────────────────────────────────────────────

export function createGoogleCalendarService(auth: GoogleAuthService): GoogleCalendarService {
  return {
    async listCalendars() {
      const items: CalendarListEntry[] = [];
      let pageToken: string | undefined;
      do {
        const url = new URL("https://www.googleapis.com/calendar/v3/users/me/calendarList");
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const token = await auth.getAccessToken();
        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`Calendar API error: ${res.status} ${await res.text()}`);
        const data = await res.json() as { items?: CalendarListEntry[]; nextPageToken?: string };
        if (data.items) items.push(...data.items);
        pageToken = data.nextPageToken;
      } while (pageToken);
      return items;
    },

    async listEvents(calendarId, opts) {
      const url = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      );
      if (opts?.syncToken) {
        url.searchParams.set("syncToken", opts.syncToken);
      } else {
        if (opts?.timeMin) url.searchParams.set("timeMin", opts.timeMin);
        if (opts?.timeMax) url.searchParams.set("timeMax", opts.timeMax);
      }
      url.searchParams.set("singleEvents", "false");
      url.searchParams.set("maxResults", "2500");
      if (opts?.pageToken) url.searchParams.set("pageToken", opts.pageToken);

      const token = await auth.getAccessToken();
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Calendar API error: ${res.status} ${await res.text()}`);
      return res.json() as Promise<EventsListResult>;
    },

    async insertEvent(calendarId, event) {
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
      const token = await auth.getAccessToken();
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      });
      if (!res.ok) throw new Error(`Calendar API error: ${res.status} ${await res.text()}`);
      return res.json() as Promise<CalendarEvent>;
    },

    async deleteEvent(calendarId, eventId) {
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
      const token = await auth.getAccessToken();
      const res = await fetch(url, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok && res.status !== 410) {
        throw new Error(`Calendar API error: ${res.status} ${await res.text()}`);
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

    async deleteEvent(_calendarId, eventId) {
      fake.events = fake.events.filter((e) => e.id !== eventId);
    },
  };

  return fake;
}
