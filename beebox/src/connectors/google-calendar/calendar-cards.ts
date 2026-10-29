/**
 * Calendar card upkeep, run once per sync after the folder map is read.
 *
 * Creates a card (and its attach folder) for a configured calendar that has
 * none, and re-stamps every card's `title` and `google-calendar:` from what
 * Google reported this sync. Only those keys are touched: the body and any
 * field a person or agent added stay as they are.
 *
 * A calendar whose events are tracked in the index but whose card is gone is
 * reported and left alone. Creating a fresh empty card for it would leave the
 * tracked files missing with nothing to re-fetch them.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { editableFrontmatterDocument, renderFrontmatterDocument, splitCardContent } from "../../exports/cards.js";
import { createCalendarTemplate } from "../../schemas/calendar.js";
import { pathExistsStrict } from "../../lib/file-exists.js";
import { calendarCardStem, cardFolder, loadCalendarFolders, type CalendarFolders } from "./calendar-folders.js";
import { localCalendarFailure, type CalendarSyncFailure } from "./notes.js";
import { entryCalendarId, isLegacyCalendarId, type EventFileIndex } from "./event-index.js";

/** What this sync learned about each calendar from Google. */
export interface CalendarFacts {
  /** Calendar id → its Google name. */
  names: Readonly<Record<string, string>>;
  /** Calendar id → this account's access role. */
  roles: Readonly<Record<string, string>>;
}

/**
 * Calendar id → how many index entries it holds. Legacy entries are left out:
 * they belong to no calendar yet and are adopted by the first pull that
 * returns their event (`lookupEventEntry`).
 */
function entryCounts(index: EventFileIndex): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [key, entry] of Object.entries(index)) {
    const id = entryCalendarId(key, entry);
    if (isLegacyCalendarId(id)) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/**
 * A card path under `calRoot` for `name` that no card holds yet. An attach
 * folder already there without its card is adopted: someone made the folder
 * first, and its files are meant for this calendar.
 */
async function freeCardPath(calRoot: string, name: string): Promise<string> {
  const stem = calendarCardStem(name);
  for (let n = 1; ; n++) {
    const candidate = path.join(calRoot, `${n === 1 ? stem : `${stem}_${String(n)}`}.calendar.card`);
    if (!await pathExistsStrict(candidate, { followLinks: false })) return candidate;
  }
}

/** Set `title` and `google-calendar` on a card; returns the new text, or undefined when unchanged or unreadable. */
function restampCard(text: string, stamp: { title: string | undefined; id: string; access: string | undefined; syncing: boolean }): string | undefined {
  const split = splitCardContent(text);
  const document = editableFrontmatterDocument(split.frontmatterText);
  if (document === null) return undefined;
  if (stamp.title !== undefined) document.set("title", stamp.title);
  const priorAccess: unknown = document.getIn(["google-calendar", "access"]);
  const access = stamp.access ?? (typeof priorAccess === "string" ? priorAccess : undefined);
  document.set("google-calendar", {
    id: stamp.id, ...(access === undefined ? {} : { access }), syncing: stamp.syncing,
  });
  const next = renderFrontmatterDocument(document, split.body);
  return next === text ? undefined : next;
}

/**
 * Bring the cards in line with the configured calendars. Adds any card it
 * creates to `folders.byId`. Returns the box-relative paths it wrote and the
 * calendars it could not give a folder.
 */
export async function upkeepCalendarCards(opts: {
  boxRoot: string;
  calRoot: string;
  folders: CalendarFolders;
  configured: readonly string[];
  facts: CalendarFacts;
  index: EventFileIndex;
}): Promise<{ written: string[]; failures: CalendarSyncFailure[] }> {
  const { boxRoot, calRoot, folders, configured, facts, index } = opts;
  const written: string[] = [];
  const failures: CalendarSyncFailure[] = [];
  const counts = entryCounts(index);

  for (const id of configured) {
    if (folders.byId.has(id) || folders.duplicated.has(id)) continue;
    const tracked = counts.get(id) ?? 0;
    if (tracked > 0) continue; // reported below with every other card-less calendar
    const cardPath = await freeCardPath(calRoot, facts.names[id] ?? id);
    const role = facts.roles[id];
    await fs.mkdir(cardFolder(cardPath), { recursive: true });
    await fs.writeFile(cardPath, createCalendarTemplate({
      name: facts.names[id] ?? id, id, ...(role === undefined ? {} : { access: role }), syncing: true,
    }));
    folders.byId.set(id, { cardPath, folder: cardFolder(cardPath) });
    written.push(path.relative(boxRoot, cardPath));
  }

  for (const [id, ref] of folders.byId) {
    const next = restampCard(await fs.readFile(ref.cardPath, "utf-8"), {
      title: facts.names[id], id, access: facts.roles[id], syncing: configured.includes(id),
    });
    if (next === undefined) continue;
    await fs.writeFile(ref.cardPath, next);
    written.push(path.relative(boxRoot, ref.cardPath));
  }

  for (const [id, tracked] of counts) {
    if (folders.byId.has(id) || folders.duplicated.has(id)) continue;
    failures.push(localCalendarFailure({
      calendarId: id, operation: "stale-cleanup",
      detail: `no calendar card for ${String(tracked)} tracked events; restore the card or remove the calendar in settings`,
    }));
  }
  return { written, failures };
}

/**
 * Read the calendar cards, bring them in line with the configuration, and
 * return the folder map the sync passes use (calendar id → folder) with the
 * card paths written. Every problem found is pushed onto `failures`.
 */
export async function prepareCalendarFolders(opts: {
  boxRoot: string;
  calRoot: string;
  configured: readonly string[];
  facts: CalendarFacts;
  index: EventFileIndex;
  failures: CalendarSyncFailure[];
}): Promise<{ folders: Map<string, string>; cardPaths: string[] }> {
  const { boxRoot, calRoot, configured, facts, index, failures } = opts;
  const found = await loadCalendarFolders({ boxRoot, calRoot });
  failures.push(...found.problems);
  const upkeep = await upkeepCalendarCards({ boxRoot, calRoot, folders: found, configured, facts, index });
  failures.push(...upkeep.failures);
  const folders = new Map([...found.byId].map(([id, ref]) => [id, ref.folder]));
  return { folders, cardPaths: upkeep.written };
}
