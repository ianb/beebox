/**
 * The events a calendar card's page lists: one folder's `.ics` files in a
 * range, recurring series expanded, sorted by start. A file that does not
 * parse is named in `unreadable` rather than dropped, so the page never says
 * "no events" over a read that was incomplete.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parsesAsEvent } from "./ics.js";
import { listIcsFiles } from "./calendar-folders.js";
import { filterByDateRange, parseIcsContent } from "./utils.js";

export interface CardEvent {
  /** ISO instants; an all-day event's are local midnights. */
  start: string;
  end: string;
  allDay: boolean;
  summary: string;
  location?: string | undefined;
  /** The event's file name within the folder. */
  file: string;
}

export async function loadCardEvents(folder: string, range: { from: Date; to: Date }): Promise<{ events: CardEvent[]; unreadable: string[] }> {
  const unreadable: string[] = [];
  const events: CardEvent[] = [];
  for (const file of await listIcsFiles(folder)) {
    const content = await fs.readFile(path.join(folder, file), "utf-8");
    if (!parsesAsEvent(content)) {
      unreadable.push(file);
      continue;
    }
    // The range expands recurring series; single events still need the filter.
    for (const event of filterByDateRange(parseIcsContent(content, { filename: file, range }), range)) {
      events.push({
        start: event.start.toISOString(), end: event.end.toISOString(), allDay: event.allDay,
        summary: event.summary, location: event.location, file,
      });
    }
  }
  events.sort((a, b) => a.start.localeCompare(b.start));
  return { events, unreadable: unreadable.toSorted() };
}
