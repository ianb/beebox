/**
 * Event file names inside a calendar folder.
 */

import { sanitizeFilenameStem } from "../../shared/filename.js";
import { type GoogleCalendarEvent } from "./ics.js";

/**
 * The name an event's `.ics` gets inside its calendar folder:
 * `{date}_{title}_{shortId}.ics`. The date leads so a folder sorts
 * chronologically; the short id (the event id's last eight characters) keeps
 * two same-day, same-title events apart. A title with no usable characters
 * drops its segment, leaving `{date}_{shortId}.ics`.
 *
 * Shared with the calendar-folders migration, which rebuilds names from the
 * date and short id already in the old filename plus the file's SUMMARY, so
 * the name it writes is the one the next pull computes.
 */
export function eventFileStem(opts: { date: string; summary: string | undefined; shortId: string }): string {
  const { date, summary, shortId } = opts;
  const title = sanitizeFilenameStem(summary ?? "", { maxLength: 40, fallback: "" });
  return title ? `${date}_${title}_${shortId}` : `${date}_${shortId}`;
}

export function eventFilename(event: GoogleCalendarEvent): string {
  const date =
    event.start?.dateTime?.slice(0, 10) ||
    event.start?.date ||
    "no-date";
  return `${eventFileStem({ date, summary: event.summary, shortId: event.id.slice(-8) })}.ics`;
}
