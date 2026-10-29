/**
 * The events a calendar card's page lists: one folder's `.ics` files in a
 * range, recurring series expanded, sorted by start. A file that does not
 * parse is named in `unreadable` rather than dropped, so the page never says
 * "no events" over a read that was incomplete.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parsesAsDatedEvent } from "./ics.js";
import { listIcsFiles } from "./calendar-folders.js";
import { filterByDateRange, parseIcsContent } from "./utils.js";

export interface CardEvent {
  /**
   * ISO instants for a timed event. An all-day event's are calendar dates
   * (`2026-11-05`), so a viewer in another zone shows it on the same day.
   */
  start: string;
  end: string;
  allDay: boolean;
  summary: string;
  location?: string | undefined;
  /** The event's file name within the folder. */
  file: string;
}

/** The calendar date of a local midnight, as ical.js gives an all-day DTSTART. */
function localDate(date: Date): string {
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export async function loadCardEvents(folder: string, range: { from: Date; to: Date }): Promise<{ events: CardEvent[]; unreadable: string[] }> {
  const unreadable: string[] = [];
  const events: Array<{ at: number; event: CardEvent }> = [];
  for (const file of await listIcsFiles(folder)) {
    const content = await fs.readFile(path.join(folder, file), "utf-8");
    if (!parsesAsDatedEvent(content)) {
      unreadable.push(file);
      continue;
    }
    // The range expands recurring series; single events still need the filter.
    for (const event of filterByDateRange(parseIcsContent(content, { filename: file, range }), range)) {
      events.push({ at: event.start.getTime(), event: {
        start: event.allDay ? localDate(event.start) : event.start.toISOString(),
        end: event.allDay ? localDate(event.end) : event.end.toISOString(),
        allDay: event.allDay,
        summary: event.summary, location: event.location, file,
      } });
    }
  }
  return {
    events: events.toSorted((a, b) => a.at - b.at).map((e) => e.event),
    unreadable: unreadable.toSorted(),
  };
}
