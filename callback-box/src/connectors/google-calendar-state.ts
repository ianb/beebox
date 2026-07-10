/**
 * Google Calendar connector state + API wrappers.
 *
 * Owns the on-disk sync state (syncTokens in gitignored transient state,
 * eventFiles in committed persistent state) and the thin Google Calendar API
 * call wrappers that translate HTTP errors into null/false results. Leaf
 * module: depends only on fs, the calendar service, and transient-state.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { HTTPError } from "ky";
import { type GoogleCalendarService } from "../services/google-calendar.js";
import { loadTransientState, updateTransientState } from "./transient-state.js";
import { type GoogleCalendarEvent } from "./google-calendar-ics.js";

interface CalendarTransientState {
  syncTokens: Record<string, string>;
}

export interface EventFileEntry {
  filename: string;
  calendarId: string;
  /** Hash of the ICS content last written by the connector (for detecting local edits) */
  contentHash?: string;
  /** Google event `updated` timestamp captured at the last pull, for remote-change detection */
  remoteUpdated?: string | undefined;
}

export interface CalendarState {
  /** syncToken per calendar ID */
  syncTokens: Record<string, string>;
  /** Google event ID → file info (or legacy plain filename string) */
  eventFiles: Record<string, string | EventFileEntry>;
}

/** Get filename from eventFiles entry (handles legacy string format) */
export function getFilename(entry: string | EventFileEntry): string {
  return typeof entry === "string" ? entry : entry.filename;
}

export function calendarStatePath(boxRoot: string): string {
  return path.join(boxRoot, "config/connectors/google-calendar-state.json");
}

export function calendarDir(boxRoot: string): string {
  return path.join(boxRoot, "store/calendar");
}

export async function loadCalendarState(boxRoot: string): Promise<CalendarState> {
  let persistent: CalendarState;
  try {
    const content = await fs.readFile(calendarStatePath(boxRoot), "utf-8");
    persistent = JSON.parse(content);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT" && !(err instanceof SyntaxError)) {
      throw err;
    }
    persistent = { syncTokens: {}, eventFiles: {} };
  }
  // Merge syncTokens from transient state (gitignored)
  const transient = await loadTransientState<CalendarTransientState>({
    boxRoot, connectorName: "google-calendar", defaultValue: { syncTokens: {} },
  });
  persistent.syncTokens = { ...persistent.syncTokens, ...transient.syncTokens };
  return persistent;
}

/**
 * Mutable per-sync baseline for the syncToken delta merge: the tokens as of
 * this sync's LAST save (initially, as loaded). A fixed start-of-sync snapshot
 * would be unsound — one sync saves several times (the 410 handler clears a
 * token mid-sync, then the full resync re-stores it), and against a fixed
 * baseline a token that round-trips value→deleted→same-value would look
 * "unchanged" and be dropped. Refreshing the baseline after each save makes
 * every save's delta relative to the previous save, which composes.
 */
export interface SyncTokenSnapshot {
  tokens: Record<string, string>;
}

/**
 * Merge one save's syncToken changes onto freshly-loaded transient tokens.
 * Per-calendarId cursor resolution, relative to `snapshot` (this sync's last
 * save — see {@link SyncTokenSnapshot}):
 *   - **added/updated** — differs from the snapshot: this save advanced it, our
 *     value wins.
 *   - **deleted** — in the snapshot but absent from `working`: this save
 *     cleared it (410 → forced full resync); remove it from the merged result
 *     (a plain spread would resurrect the stale token from `fresh`).
 *   - **untouched** — identical to the snapshot: keep `fresh`'s value, so a
 *     concurrent sync's advance of a calendar THIS save didn't touch survives
 *     (codex round-2 finding: wholesale replace regressed it).
 */
export function mergeSyncTokens(opts: {
  fresh: Record<string, string>;
  snapshot: Record<string, string>;
  working: Record<string, string>;
}): Record<string, string> {
  const { fresh, snapshot, working } = opts;
  const merged: Record<string, string> = { ...fresh };
  for (const calId of Object.keys(snapshot)) {
    if (!(calId in working)) delete merged[calId];
  }
  for (const [calId, cursor] of Object.entries(working)) {
    if (snapshot[calId] !== cursor) merged[calId] = cursor;
  }
  return merged;
}

export async function saveCalendarState(
  boxRoot: string,
  opts: { state: CalendarState; snapshot: SyncTokenSnapshot },
): Promise<void> {
  const { state, snapshot } = opts;
  // Transient side (gitignored syncTokens): serialized delta-merge (Track 1).
  // The lock prevents torn writes; the merge keeps a concurrent sync's advance
  // of a calendar this save didn't change from being clobbered.
  await updateTransientState<CalendarTransientState>({
    boxRoot,
    connectorName: "google-calendar",
    defaultValue: { syncTokens: {} },
    update: (fresh) => ({
      syncTokens: mergeSyncTokens({ fresh: fresh.syncTokens, snapshot: snapshot.tokens, working: state.syncTokens }),
    }),
  });
  // Advance the baseline: the next save's delta is relative to THIS save.
  snapshot.tokens = { ...state.syncTokens };
  // Persistent side (committed eventFiles): unchanged direct write; the git
  // commit of this file is scoped and handled by the connector (Track 2).
  const persistent = { syncTokens: {}, eventFiles: state.eventFiles };
  await fs.mkdir(path.dirname(calendarStatePath(boxRoot)), { recursive: true });
  await fs.writeFile(calendarStatePath(boxRoot), JSON.stringify(persistent, null, 2));
}

/** Delete an event via the calendar service. Returns false on HTTP errors. */
export async function deleteEventViaApi(
  calendar: GoogleCalendarService,
  opts: { calendarId: string; googleEventId: string },
): Promise<boolean> {
  const { calendarId, googleEventId } = opts;
  try {
    await calendar.deleteEvent(calendarId, googleEventId);
    return true;
  } catch (err) {
    if (err instanceof HTTPError) {
      const status = err.response.status;
      const text = await err.response.text();
      console.warn(`  API error deleting from ${calendarId}: ${status} ${text}`);
      return false;
    }
    throw err;
  }
}

/** Insert an event via the calendar service. Returns null on HTTP errors. */
export async function insertEventViaApi(
  calendar: GoogleCalendarService,
  opts: { calendarId: string; event: GoogleCalendarEvent },
): Promise<GoogleCalendarEvent | null> {
  const { calendarId, event } = opts;
  try {
    return await calendar.insertEvent(calendarId, event);
  } catch (err) {
    if (err instanceof HTTPError) {
      const status = err.response.status;
      const text = await err.response.text();
      console.warn(`  API error pushing to ${calendarId}: ${status} ${text}`);
      return null;
    }
    throw err;
  }
}

/** Patch an event via the calendar service. Returns null on HTTP errors. */
export async function patchEventViaApi(
  calendar: GoogleCalendarService,
  opts: { calendarId: string; googleEventId: string; event: GoogleCalendarEvent },
): Promise<GoogleCalendarEvent | null> {
  const { calendarId, googleEventId, event } = opts;
  try {
    return await calendar.patchEvent(calendarId, { eventId: googleEventId, event });
  } catch (err) {
    if (err instanceof HTTPError) {
      const status = err.response.status;
      const text = await err.response.text();
      console.warn(`  API error patching in ${calendarId}: ${status} ${text}`);
      return null;
    }
    throw err;
  }
}

export async function fetchEvents(
  opts: { calendar: GoogleCalendarService; calendarId: string; syncToken: string | undefined; syncDaysBack: number; syncDaysForward: number; state: CalendarState; now: Date },
): Promise<GoogleCalendarEvent[]> {
  const { calendar, calendarId, syncToken, syncDaysBack, syncDaysForward, state, now } = opts;
  const allEvents: GoogleCalendarEvent[] = [];
  let pageToken: string | undefined;

  // Compute time window for full sync (ignored when syncToken is set). `now` is
  // domain time (scenario-frozen) so the window is deterministic under a test.
  const timeMin = new Date(now);
  timeMin.setDate(timeMin.getDate() - syncDaysBack);
  const timeMax = new Date(now);
  timeMax.setDate(timeMax.getDate() + syncDaysForward);

  do {
    const listOpts: { syncToken?: string; timeMin?: string; timeMax?: string; pageToken?: string } = {};
    if (syncToken) {
      listOpts.syncToken = syncToken;
    } else {
      listOpts.timeMin = timeMin.toISOString();
      listOpts.timeMax = timeMax.toISOString();
    }
    if (pageToken) listOpts.pageToken = pageToken;

    const data = await calendar.listEvents(calendarId, listOpts);
    allEvents.push(...data.items);
    pageToken = data.nextPageToken;
    if (data.nextSyncToken) {
      state.syncTokens[calendarId] = data.nextSyncToken;
    }
  } while (pageToken);

  return allEvents;
}
