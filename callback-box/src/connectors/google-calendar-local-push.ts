/**
 * Google Calendar local-edit push.
 *
 * Two things: the one place an edited `.ics` is turned into a Google patch
 * ({@link patchLocalEdit}), and the pass that finds edits the pull never
 * reached ({@link pushPendingLocalEdits}). Leaf module — ICS, notes, and state
 * helpers only; never the connector or the sync engine.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../lib/error-guards.js";
import { contentHash } from "../lib/content-hash.js";
import { type GoogleCalendarService } from "../services/google-calendar.js";
import {
  eventToIcs,
  icsToGoogleEvent,
  type GoogleCalendarEvent,
} from "./google-calendar-ics.js";
import {
  CB_DELETE_PATTERN,
  classifyCalendarFailure,
  localCalendarFailure,
  type CalendarSyncFailure,
  type SyncNote,
} from "./google-calendar-notes.js";
import {
  patchEventViaApi,
  type CalendarState,
  type EventFileEntry,
  type IcsOptions,
} from "./google-calendar-state.js";

/**
 * What happened to a local-wins push. There is no "fall through and let
 * Google's copy win" outcome: a push we chose to make and could not complete
 * must leave the local file (and its recorded contentHash) alone, or a
 * transient 429 silently erases the boxholder's edit.
 */
export type LocalPushOutcome =
  | { kind: "pushed"; event: GoogleCalendarEvent }
  | { kind: "failed"; failure: CalendarSyncFailure };

/**
 * Send one locally-edited `.ics` to Google as a patch.
 *
 * Touches nothing on disk or in state — both failure modes (a file that will
 * not parse into an event, and a patch Google rejects) come back as `failed`
 * and it is the caller's job to leave the file alone. The unchanged stored
 * contentHash is what makes a later sync try the push again.
 */
export async function patchLocalEdit(opts: {
  calendar: GoogleCalendarService;
  calendarId: string;
  googleEventId: string;
  localContent: string;
  filename: string;
  relPath: string;
}): Promise<LocalPushOutcome> {
  const { calendar, calendarId, googleEventId, localContent, filename, relPath } = opts;

  const localEvent = icsToGoogleEvent(localContent);
  if (!localEvent) {
    console.warn(`  Local edit to ${filename} does not parse as an event, keeping it`);
    return {
      kind: "failed",
      failure: localCalendarFailure({
        calendarId, operation: "local-push", path: relPath,
        detail: "local .ics does not parse as an event",
      }),
    };
  }

  // Internal provenance field — never sent to the API.
  delete localEvent._calendarId;
  const patchResult = await patchEventViaApi(calendar, {
    calendarId, googleEventId, event: localEvent,
  });
  if (!patchResult.ok) {
    console.warn(`  Failed to push local edit for ${filename}, keeping the local file`);
    return {
      kind: "failed",
      failure: classifyCalendarFailure(patchResult.error, {
        calendarId, operation: "local-push", path: relPath,
      }),
    };
  }
  return { kind: "pushed", event: patchResult.value };
}

/**
 * Record Google's acceptance of a push, then bring the local file into line.
 *
 * The API call has already returned, so state is stamped BEFORE the local
 * write. An event Google holds must never be left looking un-pushed, and a
 * rewrite that throws — a full disk, a path something else replaced — is a
 * reported failure, not a lost update. The worst a failed rewrite can leave
 * behind is a hash mismatch, which the pending-edit pass clears next run by
 * re-patching content Google already has: idempotent, not a second edit.
 *
 * `fallbackFilename` is the name of the file that still exists when the push
 * renamed the event (the pull path's rename). On a failed rewrite the entry
 * points back at it: an entry naming a file we never wrote would strand the old
 * one untracked, and the orphan pass re-inserts untracked `.ics` files as brand
 * new Google events.
 */
export async function writeBackPushedEvent(opts: {
  state: CalendarState;
  googleEventId: string;
  entry: EventFileEntry;
  calDir: string;
  relPath: string;
  event: GoogleCalendarEvent;
  icsOpts: IcsOptions;
  fallbackFilename: string | undefined;
}): Promise<CalendarSyncFailure | undefined> {
  const { state, googleEventId, entry, calDir, relPath, event, icsOpts, fallbackFilename } = opts;
  const ics = eventToIcs(event, icsOpts);
  const pushedEntry: EventFileEntry = {
    ...entry, contentHash: contentHash(ics), remoteUpdated: event.updated,
  };
  state.eventFiles[googleEventId] = pushedEntry;
  try {
    await fs.writeFile(path.join(calDir, entry.filename), ics);
    return undefined;
  } catch (err: unknown) {
    if (fallbackFilename !== undefined && fallbackFilename !== entry.filename) {
      state.eventFiles[googleEventId] = { ...pushedEntry, filename: fallbackFilename };
    }
    console.warn(`  Pushed ${entry.filename} to Google but could not rewrite it locally:`, err);
    return classifyCalendarFailure(err, {
      calendarId: entry.calendarId, operation: "local-push", path: relPath,
    });
  }
}

/** Does this tracked entry hold an edit that still owes Google a patch? */
async function readPendingEdit(opts: {
  calDir: string;
  filename: string;
  storedHash: string;
}): Promise<string | undefined> {
  const { calDir, filename, storedHash } = opts;
  let localContent: string;
  try {
    localContent = await fs.readFile(path.join(calDir, filename), "utf-8");
  } catch (err: unknown) {
    if (errnoCode(err) !== "ENOENT") throw err;
    // A tracked event with no local file is not an edit. (The stale pass and
    // the pull both handle a missing file; there is nothing to push.)
    return undefined;
  }
  if (contentHash(localContent) === storedHash) return undefined;
  // An X-CB-DELETE marker also changes the hash, but it is a delete request,
  // not an edit: processLocalDeletes owns the file and must win. Patching it
  // would push the marker into Google's copy and re-stamp the hash, quietly
  // cancelling the deletion the boxholder asked for.
  if (CB_DELETE_PATTERN.test(localContent)) return undefined;
  return localContent;
}

/**
 * Push every tracked `.ics` whose content no longer matches the hash the
 * connector recorded — the edits this run's pull did not already handle.
 *
 * The pull can only reconcile events Google chose to return, so before this
 * pass existed a local edit was pushed *only* when the same event happened to
 * come back in a pull with an unchanged `updated` stamp — in practice only
 * during a full resync. On an ordinary incremental sync Google returns nothing
 * for an event nobody else touched, so the boxholder's edit sat on disk while
 * the sync token advanced past it, and a patch that failed once was never
 * retried for the same reason.
 *
 * The contentHash mismatch IS the retry queue: no new state, and an edit stops
 * being pending exactly when Google has accepted it. Entries this run's pull
 * (or the post-410 stale pass) already dealt with are skipped via
 * `reconciledEventIds` so nothing is pushed or reported twice.
 *
 * Skipped without comment: legacy string entries and entries with no recorded
 * hash — the connector never stamped one, so "differs from what we wrote" is
 * not a question we can answer, and guessing would push a file we may never
 * have written.
 */
export async function pushPendingLocalEdits(opts: {
  boxRoot: string;
  calendar: GoogleCalendarService;
  state: CalendarState;
  calDir: string;
  reconciledEventIds: Set<string>;
  icsOptsFor: (calendarId: string) => IcsOptions;
}): Promise<{ updated: string[]; notes: SyncNote[]; failures: CalendarSyncFailure[] }> {
  const { boxRoot, calendar, state, calDir, reconciledEventIds, icsOptsFor } = opts;
  const updated: string[] = [];
  const notes: SyncNote[] = [];
  const failures: CalendarSyncFailure[] = [];

  for (const [googleEventId, entry] of Object.entries(state.eventFiles)) {
    if (typeof entry === "string") continue;
    const storedHash = entry.contentHash;
    if (storedHash === undefined) continue;
    if (reconciledEventIds.has(googleEventId)) continue;

    const filePath = path.join(calDir, entry.filename);
    const relPath = path.relative(boxRoot, filePath);
    const localContent = await readPendingEdit({
      calDir, filename: entry.filename, storedHash,
    });
    if (localContent === undefined) continue;

    const outcome = await patchLocalEdit({
      calendar, calendarId: entry.calendarId, googleEventId,
      localContent, filename: entry.filename, relPath,
    });
    if (outcome.kind === "failed") {
      // Everything stays as it is — the file, its stored hash, the notes — so
      // the next sync finds the same mismatch and tries again.
      failures.push(outcome.failure);
      continue;
    }

    // Rewrite from Google's response to normalize, and re-stamp the hash so the
    // edit stops being pending. The filename is deliberately left alone even if
    // the edit moved the event's date: renaming is the pull path's job, which
    // owns the old-file cleanup.
    const rewriteFailure = await writeBackPushedEvent({
      state, googleEventId, entry, calDir, relPath,
      event: outcome.event, icsOpts: icsOptsFor(entry.calendarId),
      fallbackFilename: undefined,
    });
    if (rewriteFailure) {
      // Google took the edit; only the local normalization failed. The entry is
      // tracked against Google's copy, so the next run finds the mismatch and
      // re-patches the same content rather than losing or duplicating anything.
      failures.push(rewriteFailure);
      continue;
    }
    updated.push(relPath);
    notes.push({
      action: "pushed",
      summary: `${outcome.event.summary || entry.filename} (local edit pushed)`,
      ref: relPath,
    });
  }

  return { updated, notes, failures };
}
