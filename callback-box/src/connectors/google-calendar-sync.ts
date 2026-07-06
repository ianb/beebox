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
  type SyncNote,
} from "./google-calendar-notes.js";
import {
  getFilename,
  patchEventViaApi,
  fetchEvents,
  type CalendarState,
} from "./google-calendar-state.js";
import { contentHash } from "../lib/content-hash.js";
import { decideCalendarSync } from "./google-calendar-decide.js";
import { invariant } from "../lib/invariant.js";

interface IcsOpts { calendarId: string; calendarName?: string; calendarRole?: string }

interface SyncAccumulator {
  created: string[];
  updated: string[];
  deleted: string[];
  notes: SyncNote[];
}

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
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
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
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/**
 * If the local file was edited (hash mismatch), push it to Google and rewrite
 * from the response. Returns true if the event was fully handled here.
 */
async function tryPushLocalEdit(
  event: GoogleCalendarEvent,
  ctx: {
    calendar: GoogleCalendarService; icsOpts: IcsOpts; filePath: string; relPath: string;
    filename: string; localContent: string; existingEntry: string | { calendarId: string };
    state: CalendarState; acc: SyncAccumulator;
  },
): Promise<boolean> {
  const { calendar, icsOpts, filePath, relPath, filename, localContent,
          existingEntry, state, acc } = ctx;
  const localEvent = icsToGoogleEvent(localContent);
  if (!localEvent) return false;

  const entryCalId = typeof existingEntry === "string" ? icsOpts.calendarId : existingEntry.calendarId;
  delete localEvent._calendarId;
  const patchResult = await patchEventViaApi(calendar, {
    calendarId: entryCalId, googleEventId: event.id, event: localEvent,
  });
  if (!patchResult) {
    // Patch failed — fall through to overwrite with Google's version
    console.warn(`  Failed to push local edit for ${filename}, overwriting with Google version`);
    return false;
  }

  // Patch succeeded — rewrite file from Google's response to normalize
  const patchedIcs = eventToIcs(patchResult, icsOpts);
  await fs.writeFile(filePath, patchedIcs);
  state.eventFiles[event.id] = {
    filename, calendarId: icsOpts.calendarId, contentHash: contentHash(patchedIcs),
    remoteUpdated: patchResult.updated,
  };
  acc.updated.push(relPath);
  acc.notes.push({
    action: "pushed",
    summary: `${localEvent.summary || filename} (local edit pushed)`,
    ref: relPath,
  });
  return true;
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
  await unlinkRenamed({ boxRoot, calDir, oldName, filename, acc });

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
        const handled = await tryPushLocalEdit(event, {
          calendar, icsOpts, filePath, relPath, filename, localContent,
          existingEntry, state, acc,
        });
        if (handled) return;
        // Push failed — fall through to overwrite with Google's version (below).
        recordUpsertNote(event, {
          isExisting: true, localContent, icsContent, filename, relPath, calendarId, icsOpts, acc,
        });
        break;
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
}): Promise<SyncAccumulator> {
  const { boxRoot, calendar, calendarId, syncToken, syncDaysBack, syncDaysForward,
          state, icsOpts, calDir, windowStart, windowEnd } = opts;
  const acc: SyncAccumulator = { created: [], updated: [], deleted: [], notes: [] };

  const events = await fetchEvents({
    calendar, calendarId, syncToken, syncDaysBack, syncDaysForward, state,
  });

  for (const event of events) {
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
