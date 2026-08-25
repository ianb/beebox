/**
 * Google Calendar connector state + API wrappers.
 *
 * Owns the on-disk sync state (syncTokens in gitignored transient state,
 * eventFiles in committed persistent state) and the thin Google Calendar API
 * call wrappers that translate HTTP errors into null/false results. The index's
 * key format, entry shape, and migration live next door in
 * google-calendar-event-index.ts. Leaf module: depends only on fs, the calendar
 * service, transient-state, and that index module.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../lib/error-guards.js";
import { writeFileAtomic } from "../lib/atomic-write.js";
import { HTTPError } from "ky";
import { type GoogleCalendarService } from "../services/google-calendar.js";
import { loadTransientState, updateTransientState } from "./transient-state.js";
import { type GoogleCalendarEvent } from "./google-calendar-ics.js";
import {
  EVENT_INDEX_VERSION,
  migrateEventIndex,
  type EventFileIndex,
} from "./google-calendar-event-index.js";

interface CalendarTransientState {
  syncTokens: Record<string, string>;
}

/**
 * Provenance for one calendar, written into every generated `.ics` as the
 * X-CB-CALENDAR-* properties. Lives here with the connector's other shared
 * vocabulary (it is passed to `eventToIcs` by the sync, push, and local-edit
 * passes alike) rather than in the ICS module, which never needs the name.
 */
export interface IcsOptions {
  calendarId: string;
  calendarName?: string;
  calendarRole?: string;
}

export interface CalendarState {
  /** syncToken per calendar ID */
  syncTokens: Record<string, string>;
  /**
   * Tracked events, keyed `<eventId> <calendarId>` — see
   * google-calendar-event-index.ts for why the key is composite.
   */
  eventFiles: EventFileIndex;
}

/**
 * The on-disk persistent half. `version` is absent on a file written before the
 * index moved to composite keys; {@link loadCalendarState} migrates those.
 */
interface PersistedCalendarState extends CalendarState {
  version?: number;
}

export function calendarStatePath(boxRoot: string): string {
  return path.join(boxRoot, "config/connectors/google-calendar-state.json");
}

export function calendarDir(boxRoot: string): string {
  return path.join(boxRoot, "store/calendar");
}

/**
 * Thrown when the persistent calendar state exists but can't be read or parsed.
 *
 * It FAILS THE SYNC rather than starting from empty maps. `eventFiles` is not a
 * cache — `pushAndCleanOrphans` treats every `.ics` file absent from that index
 * as a locally-created event, so an empty index against a populated
 * `store/calendar/` means "insert a duplicate of every event into Google". A
 * present-but-unreadable index carries no information about which of those two
 * situations we are in, and there is no safe automatic recovery: the file has to
 * be inspected or removed by hand (removing it, with the calendar directory
 * emptied too, is the deliberate start-over). Distinct from a genuinely-absent
 * file (ENOENT → start fresh), which is the legitimate first-run case.
 */
export class CalendarStateCorruptError extends Error {
  readonly statePath: string;
  constructor(filePath: string, options: { cause: unknown }) {
    super(
      `Calendar state at ${filePath} exists but could not be read or parsed. ` +
        "Refusing to sync — inspect or remove the file by hand before syncing again.",
      options,
    );
    this.name = "CalendarStateCorruptError";
    this.statePath = filePath;
  }
}

/**
 * Load the calendar state, FAIL-CLOSED.
 *
 * ENOENT is the only tolerated failure (no state yet — start with empty maps).
 * Anything else — an I/O error, a permissions problem, or JSON that doesn't
 * parse — throws {@link CalendarStateCorruptError}.
 *
 * Keys are normalized HERE, on the way in, rather than by a `cb migrate` script.
 * The state file is connector-owned and rewritten on every sync, and no box may
 * ever sync against bare-id keys — an entry the sync cannot find is an `.ics`
 * the orphan scan re-inserts into Google, and one the stale pass reads as
 * deleted-on-Google. The rewrite reaches disk on the sync's own save. Read-only
 * callers (`cb calendar calendars`) get the normalized view in memory and write
 * nothing.
 */
export async function loadCalendarState(boxRoot: string): Promise<CalendarState> {
  const statePath = calendarStatePath(boxRoot);
  let content: string | undefined;
  try {
    content = await fs.readFile(statePath, "utf-8");
  } catch (err: unknown) {
    if (errnoCode(err) !== "ENOENT") {
      throw new CalendarStateCorruptError(statePath, { cause: err });
    }
  }
  let persistent: PersistedCalendarState;
  if (content === undefined) {
    persistent = { syncTokens: {}, eventFiles: {} };
  } else {
    try {
      // An empty file is corruption, not a fresh start: a pre-atomic truncated
      // write is exactly how one appears. JSON.parse rejects it for us.
      persistent = JSON.parse(content);
    } catch (err: unknown) {
      throw new CalendarStateCorruptError(statePath, { cause: err });
    }
  }
  // Unconditionally, by the SHAPE of the keys — never gated on the version
  // marker. A marked file can still hold a bare key (a hand repair, an older
  // binary writing between two runs of this one), and a bare key is invisible to
  // every lookup: the stale pass would then read its event as absent from Google
  // and delete the file. The pass is idempotent, so running it always costs one
  // walk of the index; `version` is only the marker we WRITE.
  const { index: eventFiles, migrated, unattributed } = migrateEventIndex(persistent.eventFiles);
  if (migrated > 0) {
    console.warn(
      `  Calendar state: re-keyed ${String(migrated)} tracked event(s) by (event, calendar)` +
      (unattributed > 0
        ? `; ${String(unattributed)} legacy entr(y/ies) carry no calendar and stay unattributed`
        : ""),
    );
  }
  // Merge syncTokens from transient state (gitignored)
  const transient = await loadTransientState<CalendarTransientState>({
    boxRoot, connectorName: "google-calendar", defaultValue: { syncTokens: {} },
  });
  return {
    syncTokens: { ...persistent.syncTokens, ...transient.syncTokens },
    eventFiles,
  };
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
  // Persistent side (committed eventFiles): atomic whole-file replacement. A
  // torn write here is not a lost cursor but a lost *index* — see
  // CalendarStateCorruptError for what an unreadable index costs. The git
  // commit of this file is scoped and handled by the connector (Track 2).
  const persistent: PersistedCalendarState = {
    version: EVENT_INDEX_VERSION, syncTokens: {}, eventFiles: state.eventFiles,
  };
  await writeFileAtomic(calendarStatePath(boxRoot), {
    content: JSON.stringify(persistent, null, 2),
  });
}

/**
 * Outcome of one Google Calendar write. `error` carries the original HTTPError
 * so the caller can classify it into a `CalendarSyncFailure` — the wrappers
 * deliberately do NOT flatten a rejection into `null`/`false` any more, because
 * every caller then had to guess whether "no result" meant a failure worth
 * reporting (see google-calendar-push.ts / google-calendar-sync.ts).
 */
export type CalendarApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

/** Delete an event via the calendar service. HTTP errors come back as `ok: false`. */
export async function deleteEventViaApi(
  calendar: GoogleCalendarService,
  opts: { calendarId: string; googleEventId: string },
): Promise<CalendarApiResult<void>> {
  const { calendarId, googleEventId } = opts;
  try {
    await calendar.deleteEvent(calendarId, googleEventId);
    return { ok: true, value: undefined };
  } catch (err) {
    if (err instanceof HTTPError) {
      const status = err.response.status;
      const text = await err.response.text();
      console.warn(`  API error deleting from ${calendarId}: ${status} ${text}`);
      return { ok: false, error: err };
    }
    throw err;
  }
}

/** Insert an event via the calendar service. HTTP errors come back as `ok: false`. */
export async function insertEventViaApi(
  calendar: GoogleCalendarService,
  opts: { calendarId: string; event: GoogleCalendarEvent },
): Promise<CalendarApiResult<GoogleCalendarEvent>> {
  const { calendarId, event } = opts;
  try {
    return { ok: true, value: await calendar.insertEvent(calendarId, event) };
  } catch (err) {
    if (err instanceof HTTPError) {
      const status = err.response.status;
      const text = await err.response.text();
      console.warn(`  API error pushing to ${calendarId}: ${status} ${text}`);
      return { ok: false, error: err };
    }
    throw err;
  }
}

/** Patch an event via the calendar service. HTTP errors come back as `ok: false`. */
export async function patchEventViaApi(
  calendar: GoogleCalendarService,
  opts: { calendarId: string; googleEventId: string; event: GoogleCalendarEvent },
): Promise<CalendarApiResult<GoogleCalendarEvent>> {
  const { calendarId, googleEventId, event } = opts;
  try {
    return { ok: true, value: await calendar.patchEvent(calendarId, { eventId: googleEventId, event }) };
  } catch (err) {
    if (err instanceof HTTPError) {
      const status = err.response.status;
      const text = await err.response.text();
      console.warn(`  API error patching in ${calendarId}: ${status} ${text}`);
      return { ok: false, error: err };
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
