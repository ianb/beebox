/**
 * Calendar folders: where each calendar's `.ics` files live.
 *
 * Each synced calendar is a `<Name>.calendar.card` directly in
 * `_content/calendar/`, and its events are in the card's attach folder,
 * `<Name>.attach/`. The map from calendar id to folder is read from the cards
 * on every sync rather than stored, so renaming a card together with its
 * folder needs no index change. Index entries name their file relative to
 * their calendar's folder.
 *
 * Leaf module: fs, the card frontmatter helpers, and the calendar schema.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { CardIOError, cardFields, parseCardText } from "../../core/card-io.js";
import { CalendarSchema } from "../../schemas/calendar.js";
import { errnoCode } from "../../shared/error-guards.js";
import { getBoxDir } from "../../lib/paths/core.js";
import { sanitizeFilenameStem } from "../../shared/filename.js";
import { localCalendarFailure, type CalendarSyncFailure } from "./notes.js";
import { loadAllEvents, type CalendarEvent } from "./utils.js";

const CARD_SUFFIX = ".calendar.card";

/** One calendar card found in `_content/calendar/`. */
export interface CalendarCardRef {
  /** Absolute path of the card file. */
  cardPath: string;
  /** Absolute path of the card's attach folder (may not exist yet). */
  folder: string;
}

export interface CalendarFolders {
  /** Calendar id → its card and folder. */
  byId: Map<string, CalendarCardRef>;
  /** Cards that could not be used; each names the card and why. */
  problems: CalendarSyncFailure[];
  /** Calendars claimed by more than one card, so by none in `byId`. */
  duplicated: Set<string>;
}

/**
 * The file-name stem for a new calendar card, from the calendar's name. A
 * primary calendar is named by its account's address, so `@` and `.` become
 * separators rather than vanishing (`me_example_com`, not `meexamplecom`).
 */
export function calendarCardStem(name: string): string {
  return sanitizeFilenameStem(name.replace(/[.@]/g, " "), { fallback: "Calendar" });
}

/** The attach folder of a calendar card, by the card's absolute path. */
export function cardFolder(cardPath: string): string {
  return `${cardPath.slice(0, -CARD_SUFFIX.length)}.attach`;
}

/** Path of the calendar-folders migration journal; while it exists the connector must not sync. */
export function calendarMigrationJournalPath(boxRoot: string): string {
  return path.join(getBoxDir(boxRoot, "connectorState"), "google-calendar-migration.json");
}

const CALENDAR_SCHEMAS = new Map([[CalendarSchema.type, CalendarSchema]]);

/** The calendar a card names, or undefined when the card does not parse as one. */
async function readCardId(cardPath: string): Promise<string | undefined> {
  try {
    const card = parseCardText(await fs.readFile(cardPath, "utf-8"), { source: cardPath, schemas: CALENDAR_SCHEMAS });
    return cardFields(card, CalendarSchema)["google-calendar"].id;
  } catch (err: unknown) {
    if (err instanceof CardIOError) return undefined;
    throw err;
  }
}

/**
 * Read every calendar card in `calRoot`. A card that does not parse, or a
 * second card claiming a calendar id already claimed, is a problem; both
 * cards of a duplicated id are left out, so that calendar is not synced until
 * a person resolves it.
 */
export async function loadCalendarFolders(opts: { boxRoot: string; calRoot: string }): Promise<CalendarFolders> {
  const { boxRoot, calRoot } = opts;
  const byId = new Map<string, CalendarCardRef>();
  const problems: CalendarSyncFailure[] = [];
  let names: string[];
  try {
    names = await fs.readdir(calRoot);
  } catch (err: unknown) {
    if (errnoCode(err) !== "ENOENT") throw err;
    return { byId, problems, duplicated: new Set() };
  }
  const duplicated = new Set<string>();
  for (const name of names.filter((n) => n.endsWith(CARD_SUFFIX)).toSorted()) {
    const cardPath = path.join(calRoot, name);
    const rel = path.relative(boxRoot, cardPath);
    const id = await readCardId(cardPath);
    if (id === undefined) {
      problems.push(localCalendarFailure({
        calendarId: "(unknown)", operation: "stale-cleanup", path: rel,
        detail: "calendar card does not parse; its calendar is not synced",
      }));
      continue;
    }
    const prior = byId.get(id);
    if (prior !== undefined || duplicated.has(id)) {
      duplicated.add(id);
      byId.delete(id);
      problems.push(localCalendarFailure({
        calendarId: id, operation: "stale-cleanup", path: rel,
        detail: "two calendar cards name this calendar; it is not synced until one is removed",
      }));
      continue;
    }
    byId.set(id, { cardPath, folder: cardFolder(cardPath) });
  }
  return { byId, problems, duplicated };
}

/** The `.ics` files directly in a folder (not `stranded/`), or none when it does not exist. */
export async function listIcsFiles(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).filter((f) => f.endsWith(".ics"));
  } catch (err: unknown) {
    if (errnoCode(err) !== "ENOENT") throw err;
    return [];
  }
}

/**
 * Every calendar folder's events in a range, merged and sorted by start, for
 * the `bbx calendar` view. Recurring events are expanded within the range;
 * the caller still filters single events to it (`filterByDateRange`).
 */
export async function loadBoxEvents(boxRoot: string, range: { from: Date; to: Date }): Promise<CalendarEvent[]> {
  const { byId } = await loadCalendarFolders({ boxRoot, calRoot: getBoxDir(boxRoot, "calendar") });
  const perFolder = await Promise.all([...byId.values()].map(async (ref) => loadAllEvents(ref.folder, range)));
  return perFolder.flat().toSorted((a, b) => a.start.getTime() - b.start.getTime());
}
