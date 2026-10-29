/**
 * `calendar-folders-2026-10` planner: where every calendar file goes. Pure:
 * the runner reads the box and hands over what it found.
 *
 * Before: one flat `_content/calendar/` of `{date}_{shortId}.ics` files.
 * After: one `<Name>.calendar.card` per calendar, its events in
 * `<Name>.attach/` as `{date}_{title}_{shortId}.ics`. Paths here are relative
 * to `_content/calendar/`.
 */

import { contentHash } from "../../../lib/content-hash.js";
import { calendarCardStem } from "../../../connectors/google-calendar/calendar-folders.js";
import { eventFileStem } from "../../../connectors/google-calendar/event-filename.js";
import { icsToGoogleEvent } from "../../../connectors/google-calendar/ics.js";
import {
  entryCalendarId,
  eventKey,
  getFilename,
  isLegacyCalendarId,
  parseEventKey,
  type EventFileIndex,
} from "../../../connectors/google-calendar/event-index.js";

export interface CalendarFoldersInput {
  index: EventFileIndex;
  /** `.ics` files directly in `_content/calendar/`: name → content. */
  topFiles: ReadonlyMap<string, string>;
  /** `.ics` files in `_content/calendar/stranded/`: name → content. */
  strandedFiles: ReadonlyMap<string, string>;
  /** Calendar cards already present: calendar id → card stem (`Family` for `Family.calendar.card`). */
  cards: ReadonlyMap<string, string>;
  /** Every name directly in `_content/calendar/` and one level into each attach folder (`Family.attach/x.ics`). */
  existing: ReadonlySet<string>;
  /** The configured calendars, in order, with the cached Google names and roles. */
  calendars: readonly string[];
  names: Readonly<Record<string, string>>;
  roles: Readonly<Record<string, string>>;
}

export interface PlannedCard {
  stem: string;
  id: string;
  name: string;
  access: string | undefined;
  syncing: boolean;
}

export type CalendarFoldersPlan =
  | { kind: "current" }
  | { kind: "error"; reasons: string[] }
  | {
    kind: "migrate";
    cards: PlannedCard[];
    moves: Array<{ from: string; to: string }>;
    index: EventFileIndex;
    /** Stranded files with no provable calendar, left where they are. */
    leftAlone: string[];
    /** Index keys dropped because another entry kept the file they shared. */
    untracked: string[];
  };

const OLD_DATE = /^(\d{4}-\d{2}-\d{2}|no-date)_/;

/** SUMMARY, DTSTART's date, and X-BBX-CALENDAR-ID of an `.ics`. */
function readIcs(content: string): { summary: string | undefined; date: string | undefined; calendarId: string | undefined } {
  const event = icsToGoogleEvent(content);
  if (event === null) return { summary: undefined, date: undefined, calendarId: undefined };
  return {
    // eventToIcs writes "(no title)" for an event without one, and the reader
    // returns it for a file without one; the pull names that event from its
    // missing summary, so this must count as none.
    summary: event.summary === "(no title)" ? undefined : event.summary,
    // A timed start reads back as a UTC instant, so near midnight this date can
    // differ from the wall date the pull uses. It is only the fallback for a
    // name without a date; the cost of a miss is one more rename on a later pull.
    date: event.start?.date ?? event.start?.dateTime?.slice(0, 10),
    calendarId: event._calendarId === "" ? undefined : event._calendarId,
  };
}

/** The new name for a tracked file, or undefined to keep the name it has. */
function newEventName(opts: { filename: string; eventId: string; content: string }): string | undefined {
  const { filename, eventId, content } = opts;
  const ics = readIcs(content);
  const date = OLD_DATE.exec(filename)?.[1] ?? ics.date;
  if (date === undefined) return undefined;
  return `${eventFileStem({ date, summary: ics.summary, shortId: eventId.slice(-8) })}.ics`;
}

/**
 * Entries that share one file with another entry, to drop. The keeper is the
 * one whose recorded hash matches the file, when exactly one does, else the
 * first — the same choice the connector's `dropDuplicateFilenames` makes. Two
 * moves out of one file could never both finish.
 */
function sharedFileLosers(index: EventFileIndex, topFiles: ReadonlyMap<string, string>): Set<string> {
  const byFile = new Map<string, string[]>();
  for (const [key, entry] of Object.entries(index)) {
    const keys = byFile.get(getFilename(entry));
    if (keys) keys.push(key);
    else byFile.set(getFilename(entry), [key]);
  }
  const losers = new Set<string>();
  for (const [file, keys] of byFile) {
    if (keys.length < 2) continue;
    const content = topFiles.get(file);
    const hash = content === undefined ? undefined : contentHash(content);
    const matching = keys.filter((key) => {
      const entry = index[key];
      return entry !== undefined && typeof entry !== "string" && entry.contentHash === hash;
    });
    const keeper = matching.length === 1 ? matching[0] : keys[0];
    for (const key of keys) if (key !== keeper) losers.add(key);
  }
  return losers;
}

/** Converged: nothing at the top level to move, and every calendar the box needs has a card. */
function isCurrent(input: CalendarFoldersInput): boolean {
  const { index, topFiles, strandedFiles, cards, calendars } = input;
  if (topFiles.size > 0 || [...strandedFiles.values()].some((c) => readIcs(c).calendarId !== undefined)) return false;
  const needed = new Set(calendars);
  for (const [key, entry] of Object.entries(index)) {
    const id = entryCalendarId(key, entry);
    if (!isLegacyCalendarId(id)) needed.add(id);
  }
  return [...needed].every((id) => cards.has(id));
}

export function planCalendarFolders(input: CalendarFoldersInput): CalendarFoldersPlan {
  const { index, topFiles, strandedFiles, cards, existing, calendars, names, roles } = input;
  if (isCurrent(input)) return { kind: "current" };
  const reasons: string[] = [];
  const stems = new Map(cards);
  const planned: PlannedCard[] = [];
  const takenStems = new Set([...existing].filter((n) => n.endsWith(".calendar.card")).map((n) => n.slice(0, -".calendar.card".length)));
  const stemFor = (id: string): string => {
    const held = stems.get(id);
    if (held !== undefined) return held;
    const base = calendarCardStem(names[id] ?? id);
    let stem = base;
    for (let n = 2; takenStems.has(stem) || existing.has(`${stem}.attach`); n++) stem = `${base}_${String(n)}`;
    takenStems.add(stem);
    stems.set(id, stem);
    planned.push({ stem, id, name: names[id] ?? id, access: roles[id], syncing: calendars.includes(id) });
    return stem;
  };
  for (const id of calendars) stemFor(id);

  const moves: Array<{ from: string; to: string }> = [];
  const nextIndex: EventFileIndex = {};
  const claimed = new Set<string>();
  const move = (from: string, to: string): void => {
    if (claimed.has(to) || existing.has(to)) reasons.push(`${from}: destination ${to} is already taken`);
    claimed.add(to);
    moves.push({ from, to });
  };

  const losers = sharedFileLosers(index, topFiles);
  for (const [key, entry] of Object.entries(index)) {
    if (losers.has(key)) continue;
    const filename = getFilename(entry);
    const content = topFiles.get(filename);
    let calendarId = entryCalendarId(key, entry);
    if (isLegacyCalendarId(calendarId)) {
      const named = content === undefined ? undefined : readIcs(content).calendarId;
      if (named === undefined) {
        reasons.push(`${filename}: tracked with no calendar, and the file names none`);
        continue;
      }
      calendarId = named;
    }
    const { eventId } = parseEventKey(key);
    const stem = stemFor(calendarId);
    // A tracked file already missing keeps its name; there is nothing to move.
    const name = content === undefined ? filename : newEventName({ filename, eventId, content }) ?? filename;
    if (content !== undefined) move(filename, `${stem}.attach/${name}`);
    const base = typeof entry === "string" ? { filename: name, calendarId } : { ...entry, filename: name, calendarId };
    nextIndex[eventKey({ calendarId, eventId })] = base;
  }

  const trackedNames = new Set(Object.values(index).map(getFilename));
  for (const [file, content] of topFiles) {
    if (trackedNames.has(file)) continue;
    // A local event not yet pushed goes where today's push would send it.
    const calendarId = readIcs(content).calendarId ?? calendars[0];
    if (calendarId === undefined) {
      reasons.push(`${file}: untracked, names no calendar, and none is configured`);
      continue;
    }
    move(file, `${stemFor(calendarId)}.attach/${file}`);
  }

  const leftAlone: string[] = [];
  for (const [file, content] of strandedFiles) {
    const calendarId = readIcs(content).calendarId;
    if (calendarId === undefined) leftAlone.push(`stranded/${file}`);
    else move(`stranded/${file}`, `${stemFor(calendarId)}.attach/stranded/${file}`);
  }

  if (reasons.length > 0) return { kind: "error", reasons };
  return { kind: "migrate", cards: planned, moves, index: nextIndex, leftAlone, untracked: [...losers] };
}
