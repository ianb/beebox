/**
 * Inbound zod schemas for the Google Calendar responses the real
 * {@link createGoogleCalendarService} consumes (Track D.2). Narrow and
 * drift-tolerant: unknown keys are ignored, and the enum-ish fields
 * (`status`, attendee `responseStatus`, `transparency`) are validated as plain
 * strings so a new Google-side value can't break a sync — the interface keeps
 * the tighter literal-union typing on the value we pass through unchanged.
 */

import { z } from "zod";

const eventDateTimeSchema = z.object({
  dateTime: z.string().optional(),
  date: z.string().optional(),
  timeZone: z.string().optional(),
});

export const calendarEventSchema = z.object({
  id: z.string(),
  status: z.string(),
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  start: eventDateTimeSchema.optional(),
  end: eventDateTimeSchema.optional(),
  created: z.string().optional(),
  updated: z.string().optional(),
  recurrence: z.array(z.string()).optional(),
  recurringEventId: z.string().optional(),
  organizer: z.object({ email: z.string().optional(), displayName: z.string().optional() }).optional(),
  attendees: z
    .array(
      z.object({
        email: z.string().optional(),
        displayName: z.string().optional(),
        responseStatus: z.string().optional(),
      }),
    )
    .optional(),
  iCalUID: z.string().optional(),
  transparency: z.string().optional(),
});

export const calendarEventsListSchema = z.object({
  items: z.array(calendarEventSchema),
  nextPageToken: z.string().optional(),
  nextSyncToken: z.string().optional(),
});

export const calendarListSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        summary: z.string(),
        description: z.string().optional(),
        primary: z.boolean().optional(),
        accessRole: z.string(),
        backgroundColor: z.string().optional(),
      }),
    )
    .optional(),
  nextPageToken: z.string().optional(),
});
