/**
 * Google Calendar sync engine — per-calendar event reconciliation and the
 * push/delete passes over locally-edited .ics files.
 *
 * Free functions invoked by the google-calendar connector. They take boxRoot
 * (for relative-path computation) plus the live CalendarState and an injected
 * GoogleCalendarService. Leaf module: depends on the ICS, notes, and state
 * helpers — never imports the connector back.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../lib/error-guards.js";
import { type GoogleCalendarService } from "../services/google-calendar.js";
import {
  eventToIcs,
  eventFilename,
  isInWindow,
  icsToGoogleEvent,
  type GoogleCalendarEvent,
} from "./google-calendar-ics.js";
import {
  formatEventDate,
  describeChanges,
  classifyCalendarFailure,
  localCalendarFailure,
  type CalendarSyncFailure,
  type SyncNote,
} from "./google-calendar-notes.js";
import {
  getFilename,
  patchEventViaApi,
  fetchEvents,
  type CalendarState,
} from "./google-calendar-state.js";
import { contentHash } from "../lib/content-hash.js";
import { getBoxTime } from "../lib/time.js";
import { decideCalendarSync } from "./google-calendar-decide.js";
import { invariant } from "../lib/invariant.js";

interface IcsOpts { calendarId: string; calendarName?: string; calendarRole?: string }

export interface SyncAccumulator {
  created: string[];
  updated: string[];
  deleted: string[];
  notes: SyncNote[];
  /** Push-side failures raised while reconciling this calendar's events. */
  failures: CalendarSyncFailure[];
  /**
   * Every event id Google returned in THIS attempt, before window/cancelled
   * filtering. Only meaningful for a full-window fetch, where it is the
   * complete picture the post-410 stale reconciliation diffs against.
   */
  seenEventIds: Set<string>;
}

/**
 * What happened to a selected local-wins push. There is no "fall through and
 * let Google's copy win" outcome: a push we chose to make and could not
 * complete must leave the local file (and its recorded contentHash) alone, or
 * a transient 429 silently erases the boxholder's edit.
 */
type LocalPushOutcome =
  | { kind: "pushed" }
  | { kind: "failed"; failure: CalendarSyncFailure };

/** Handle a cancelled event: delete the local file and untrack it. */
async function handleCancelledEvent(
  event: GoogleCalendarEvent,
  ctx: { boxRoot: string; calDir: string; state: CalendarState; acc: SyncAccumulator },
): Promise<void> {
  const { boxRoot, calDir, state, acc } = ctx;
  const existingEntry = state.eventFiles[event.id];
  const decision = decideCalendarSync({ source: "remote-cancelled", tracked: existingEntry !== undefined });
  if (decision.kind === "noop") return;
  invariant(decision.kind === "delete" && existingEntry !== undefined, "cancelled tracked event must delete");

  const oldName = getFilename(existingEntry);
  const filePath = path.join(calDir, oldName);
  try {
    await fs.unlink(filePath);
    acc.deleted.push(path.relative(boxRoot, filePath));
    acc.notes.push({ action: "cancelled", summary: event.summary || oldName });
  } catch (err: unknown) {
    if (errnoCode(err) !== "ENOENT") throw err;
  }
  delete state.eventFiles[event.id];
}

/** Remove a stale renamed file when an event's filename changed. */
async function unlinkRenamed(
  opts: { boxRoot: string; calDir: string; oldName: string | undefined; filename: string; acc: SyncAccumulator },
): Promise<void> {
  const { boxRoot, calDir, oldName, filename, acc } = opts;
  if (!oldName || oldName === filename) return;
  try {
    await fs.unlink(path.join(calDir, oldName));
    acc.deleted.push(path.relative(boxRoot, path.join(calDir, oldName)));
  } catch (err: unknown) {
    if (errnoCode(err) !== "ENOENT") throw err;
  }
}

/**
 * The local file was edited and Google's copy was not, so the local edit is
 * pushed and the file rewritten from the response.
 *
 * Both failure modes — a local file we cannot parse into an event, and a patch
 * Google rejects — return `failed` and touch NOTHING on disk or in state. The
 * caller must not write Google's version over the file afterwards: the edit is
 * still the only copy of what the boxholder wrote, and the unchanged stored
 * contentHash is what makes the next sync try the push again.
 */
async function tryPushLocalEdit(
  event: GoogleCalendarEvent,
  ctx: {
    boxRoot: string; calDir: string; oldName: string | undefined;
    calendar: GoogleCalendarService; icsOpts: IcsOpts; filePath: string; relPath: string;
    filename: string; localContent: string; existingEntry: string | { calendarId: string };
    state: CalendarState; acc: SyncAccumulator;
  },
): Promise<LocalPushOutcome> {
  const { boxRoot, calDir, oldName, calendar, icsOpts, filePath, relPath, filename,
          localContent, existingEntry, state, acc } = ctx;
  const entryCalId = typeof existingEntry === "string" ? icsOpts.calendarId : existingEntry.calendarId;
  const fail = (err: unknown): LocalPushOutcome => ({
    kind: "failed",
    failure: classifyCalendarFailure(err, {
      calendarId: entryCalId, operation: "local-push", path: relPath,
    }),
  });

  const localEvent = icsToGoogleEvent(localContent);
  if (!localEvent) {
    console.warn(`  Local edit to ${filename} does not parse as an event, keeping it`);
    return {
      kind: "failed",
      failure: localCalendarFailure({
        calendarId: entryCalId, operation: "local-push", path: relPath,
        detail: "local .ics does not parse as an event",
      }),
    };
  }

  delete localEvent._calendarId;
  const patchResult = await patchEventViaApi(calendar, {
    calendarId: entryCalId, googleEventId: event.id, event: localEvent,
  });
  if (!patchResult.ok) {
    console.warn(`  Failed to push local edit for ${filename}, keeping the local file`);
    return fail(patchResult.error);
  }

  // Patch succeeded — rewrite file from Google's response to normalize. Only
  // here is dropping a renamed predecessor safe; on the failure paths above the
  // old file is still the boxholder's only copy.
  await unlinkRenamed({ boxRoot, calDir, oldName, filename, acc });
  const patchedIcs = eventToIcs(patchResult.value, icsOpts);
  await fs.writeFile(filePath, patchedIcs);
  state.eventFiles[event.id] = {
    filename, calendarId: icsOpts.calendarId, contentHash: contentHash(patchedIcs),
    remoteUpdated: patchResult.value.updated,
  };
  acc.updated.push(relPath);
  acc.notes.push({
    action: "pushed",
    summary: `${localEvent.summary || filename} (local edit pushed)`,
    ref: relPath,
  });
  return { kind: "pushed" };
}

/** Build the SyncNote for an updated/new event (does not write the file). */
function recordUpsertNote(
  event: GoogleCalendarEvent,
  ctx: {
    isExisting: boolean; localContent: string | undefined; icsContent: string;
    filename: string; relPath: string; calendarId: string; icsOpts: IcsOpts;
    acc: SyncAccumulator;
  },
): void {
  const { isExisting, localContent, icsContent, filename, relPath,
          calendarId, icsOpts, acc } = ctx;
  if (isExisting) {
    if (localContent) {
      const changes = describeChanges(localContent, icsContent);
      if (changes.length === 0) return; // no visible changes — just a metadata refresh
      acc.notes.push({
        action: "updated", summary: event.summary || filename, detail: changes.join(", "), ref: relPath,
      });
    } else {
      acc.notes.push({ action: "updated", summary: event.summary || filename, ref: relPath });
    }
    return;
  }

  const dateStr = formatEventDate(event);
  const calLabel = icsOpts.calendarName && calendarId !== "primary" ? `, ${icsOpts.calendarName}` : "";
  acc.notes.push({
    action: "new",
    summary: `${event.summary || "(no title)"}${dateStr ? ` (${dateStr}${calLabel})` : ""}`,
    ref: relPath,
  });
}

/** Reconcile a single non-cancelled, in-window event into the local store. */
async function reconcileEvent(
  event: GoogleCalendarEvent,
  ctx: { boxRoot: string; calendar: GoogleCalendarService; calendarId: string; icsOpts: IcsOpts; calDir: string; state: CalendarState; acc: SyncAccumulator },
): Promise<void> {
  const { boxRoot, calendar, calendarId, icsOpts, calDir, state, acc } = ctx;
  const filename = eventFilename(event);
  const filePath = path.join(calDir, filename);
  const icsContent = eventToIcs(event, icsOpts);

  const existingEntry = state.eventFiles[event.id];
  const oldName = existingEntry ? getFilename(existingEntry) : undefined;
  const relPath = path.relative(boxRoot, filePath);

  if (existingEntry) {
    const storedHash = typeof existingEntry === "string" ? undefined : existingEntry.contentHash;
    let localContent: string | undefined;
    try {
      localContent = await fs.readFile(path.join(calDir, oldName || filename), "utf-8");
    } catch (_e) {
      // File missing — localContent stays undefined and we proceed to write the fresh ICS; the read is only for local-edit detection, not required.
    }

    const localEdited = localContent !== undefined && storedHash !== undefined
      && contentHash(localContent) !== storedHash;
    const storedRemoteUpdated = typeof existingEntry === "string" ? undefined : existingEntry.remoteUpdated;
    const remoteChanged = storedRemoteUpdated !== undefined && event.updated !== undefined
      && event.updated !== storedRemoteUpdated;
    const decision = decideCalendarSync({
      source: "remote-event", tracked: true, localEdited, remoteChanged,
    });

    switch (decision.kind) {
      case "local-wins": {
        // localEdited && !remoteChanged: localContent is defined here.
        invariant(localContent !== undefined, "local-wins requires local content");
        const outcome = await tryPushLocalEdit(event, {
          boxRoot, calDir, oldName, calendar, icsOpts, filePath, relPath, filename,
          localContent, existingEntry, state, acc,
        });
        // Either way this event is finished. A failed push returns WITHOUT
        // writing Google's ICS or re-stamping the contentHash, so the local
        // edit survives and the next sync retries it.
        if (outcome.kind === "failed") acc.failures.push(outcome.failure);
        return;
      }
      case "remote-wins": {
        if (localEdited) {
          // Conflict: the event changed both locally and remotely since the last
          // pull. Remote wins — discard the local edit; the write path below
          // overwrites the local file with Google's ICS.
          console.warn(
            `  Local edit to ${filename} discarded — event also changed remotely (remote wins)`,
          );
          acc.notes.push({
            action: "updated",
            summary: event.summary || filename,
            detail: "local edit discarded — event also changed remotely (remote wins)",
            ref: relPath,
          });
        } else {
          recordUpsertNote(event, {
            isExisting: true, localContent, icsContent, filename, relPath, calendarId, icsOpts, acc,
          });
        }
        break;
      }
      case "delete":
      case "noop":
        invariant(false, `unexpected ${decision.kind} decision for a tracked in-window remote event`);
    }
  } else {
    recordUpsertNote(event, {
      isExisting: false, localContent: undefined, icsContent, filename, relPath, calendarId, icsOpts, acc,
    });
  }

  // Only now that the write is certain: dropping the old name before we know
  // we will write a replacement would leave the event with no file at all.
  await unlinkRenamed({ boxRoot, calDir, oldName, filename, acc });
  await fs.writeFile(filePath, icsContent);
  if (existingEntry) acc.updated.push(relPath);
  else acc.created.push(relPath);
  state.eventFiles[event.id] = {
    filename, calendarId: icsOpts.calendarId, contentHash: contentHash(icsContent),
    remoteUpdated: event.updated,
  };
}

export async function syncCalendar(opts: {
  boxRoot: string;
  calendar: GoogleCalendarService;
  calendarId: string;
  syncToken: string | undefined;
  syncDaysBack: number;
  syncDaysForward: number;
  state: CalendarState;
  icsOpts: IcsOpts;
  calDir: string;
  windowStart: Date;
  windowEnd: Date;
  acc: SyncAccumulator;
}): Promise<SyncAccumulator> {
  const { boxRoot, calendar, calendarId, syncToken, syncDaysBack, syncDaysForward,
          state, icsOpts, calDir, windowStart, windowEnd, acc } = opts;

  const events = await fetchEvents({
    calendar, calendarId, syncToken, syncDaysBack, syncDaysForward, state, now: getBoxTime(boxRoot),
  });

  for (const event of events) {
    acc.seenEventIds.add(event.id);
    // Skip exception instances (single-instance overrides of recurring events).
    // We only store the recurring master with its RRULE.
    if (event.recurringEventId) continue;

    if (event.status === "cancelled") {
      await handleCancelledEvent(event, { boxRoot, calDir, state, acc });
      continue;
    }

    if (!isInWindow(event, { start: windowStart, end: windowEnd })) continue;

    await reconcileEvent(event, { boxRoot, calendar, calendarId, icsOpts, calDir, state, acc });
  }

  return acc;
}
