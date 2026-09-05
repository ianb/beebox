/**
 * Google Calendar local-file push/delete passes.
 *
 * Reconciles the box's .ics files *toward* Google: pushes locally-created
 * untracked files, cleans unparseable orphans, and honors X-BBX-DELETE markers.
 * Counterpart to google-calendar-sync.ts (which pulls from Google). Leaf
 * module — depends only on the ICS, notes, and state helpers.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../lib/error-guards.js";
import { contentHash } from "../lib/content-hash.js";
import { type GoogleCalendarService } from "../services/google-calendar.js";
import { validateIcsTimezone } from "./calendar-utils.js";
import { icsToGoogleEvent } from "./google-calendar-ics.js";
import { decideCalendarSync } from "./google-calendar-decide.js";
import { invariant } from "../lib/invariant.js";
import {
  BBX_DELETE_PATTERN,
  formatEventDate,
  extractBbxAnnotations,
  classifyCalendarFailure,
  type CalendarSyncFailure,
  type SyncNote,
} from "./google-calendar-notes.js";
import {
  deleteEventViaApi,
  insertEventViaApi,
  type CalendarState,
} from "./google-calendar-state.js";
import {
  eventKey,
  getFilename,
  parseEventKey,
  type EventFileEntry,
} from "./google-calendar-event-index.js";

/**
 * Push locally-created .ics files (not tracked in state) to Google Calendar,
 * then track them. Returns { pushed, deleted, notes, failures }.
 *
 * Every way a file can fail to reach Google — a rejected insert, an
 * unusable timezone, an unexpected per-file error — produces a
 * CalendarSyncFailure. These used to be console warnings only, so a file that
 * could never be pushed retried forever while the sync reported success.
 */
export async function pushAndCleanOrphans(
  opts: { boxRoot: string; calendar: GoogleCalendarService; state: CalendarState; calDir: string; defaultCalendarId: string },
): Promise<{ pushed: string[]; deleted: string[]; notes: SyncNote[]; failures: CalendarSyncFailure[] }> {
  const { boxRoot, calendar, state, calDir, defaultCalendarId } = opts;
  const pushed: string[] = [];
  const deleted: string[] = [];
  const notes: SyncNote[] = [];
  const failures: CalendarSyncFailure[] = [];
  // Also what keeps this pass from ever needing uniqueEventFilename: a file it
  // pushes is one no entry names, so tracking it under its on-disk name cannot
  // collide with another entry's file.
  const trackedFiles = new Set<string>();
  for (const entry of Object.values(state.eventFiles)) {
    trackedFiles.add(getFilename(entry));
  }

  // A flat readdir, deliberately: it must NOT descend into `stranded/`, whose
  // `.ics` files are edits given up on (google-calendar-strand.ts) and would be
  // read here as locally-created events and inserted into Google.
  let files: string[];
  try {
    files = await fs.readdir(calDir);
  } catch (err: unknown) {
    if (errnoCode(err) !== "ENOENT") throw err;
    return { pushed, deleted, notes, failures };
  }

  for (const file of files) {
    if (!file.endsWith(".ics")) continue;
    if (trackedFiles.has(file)) continue;

    const filePath = path.join(calDir, file);
    const relPath = path.relative(boxRoot, filePath);

    try {
      const content = await fs.readFile(filePath, "utf-8");
      const apiEvent = icsToGoogleEvent(content);
      if (!apiEvent) {
        // Unparseable — delete orphan
        await fs.unlink(filePath);
        deleted.push(relPath);
        continue;
      }

      // Validate timezone on non-all-day events. Unfixable without a human
      // editing the file, so it is a failure rather than a silent skip.
      const tzError = validateIcsTimezone(content);
      if (tzError) {
        console.warn(`  Skipping ${file}: ${tzError}`);
        failures.push(classifyCalendarFailure(new Error(tzError), {
          calendarId: defaultCalendarId, operation: "local-push", path: relPath,
        }));
        continue;
      }

      // Extract and strip annotations before pushing
      const { reason, ref, stripped } = extractBbxAnnotations(content);

      // Determine target calendar from X-BBX-CALENDAR-ID or use default
      const calendarId = apiEvent._calendarId || defaultCalendarId;
      // Remove our internal field before sending to API
      delete apiEvent._calendarId;

      const result = await insertEventViaApi(calendar, { calendarId, event: apiEvent });
      if (result.ok) {
        // Google has created the event — track it NOW, hashed against the bytes
        // currently on disk. Nothing after this point may leave it untracked:
        // an untracked .ics is a locally-created event to the next run's orphan
        // scan, which would insert a SECOND copy into Google. (The hash matters
        // on its own too: without one the entry has nothing to compare against,
        // so a later edit to a locally-created event looks identical to the
        // original forever and never enters the pending-edit push.)
        const trackedEntry: EventFileEntry = {
          filename: file,
          calendarId,
          contentHash: contentHash(content),
          remoteUpdated: result.value.updated,
        };
        const key = eventKey({ calendarId, eventId: result.value.id });
        state.eventFiles[key] = trackedEntry;

        // Now strip the annotations from the local copy and re-stamp the hash
        // to the bytes that ended up on disk. A rewrite that fails is a
        // reported failure: the file keeps its annotations and the entry keeps
        // matching it, so the next run neither re-pushes nor duplicates it.
        if (reason || ref) {
          try {
            await fs.writeFile(filePath, stripped);
            state.eventFiles[key] = {
              ...trackedEntry, contentHash: contentHash(stripped),
            };
          } catch (err: unknown) {
            console.warn(`  Pushed ${file} to Google but could not rewrite it locally:`, err);
            failures.push(classifyCalendarFailure(err, {
              calendarId, operation: "local-push", path: relPath,
            }));
          }
        }
        pushed.push(relPath);

        // Build push note
        const dateStr = formatEventDate(apiEvent);
        const pushNote: SyncNote = {
          action: "pushed",
          summary: `${apiEvent.summary || file}${dateStr ? ` (${dateStr})` : ""}`,
        };
        if (reason) pushNote.detail = reason;
        if (ref) pushNote.ref = ref;
        notes.push(pushNote);
      } else {
        // Push failed — leave the file alone (don't delete it) so the next
        // sync retries, and report the failure so the retry loop is visible.
        console.warn(`  Failed to push ${file}, keeping locally`);
        failures.push(classifyCalendarFailure(result.error, {
          calendarId, operation: "local-push", path: relPath,
        }));
      }
    } catch (err: unknown) {
      console.warn(`  Error processing ${file}:`, err);
      failures.push(classifyCalendarFailure(err, {
        calendarId: defaultCalendarId, operation: "local-push", path: relPath,
      }));
    }
  }

  return { pushed, deleted, notes, failures };
}

/**
 * Scan tracked .ics files for X-BBX-DELETE property. If found, delete the
 * event from Google Calendar, remove the local file, and untrack it.
 * Safety cap: at most 3 deletes per sync. Skips read-only calendars.
 */
export async function processLocalDeletes(
  opts: { boxRoot: string; calendar: GoogleCalendarService; state: CalendarState; calDir: string },
): Promise<{ deleted: string[]; notes: SyncNote[]; failures: CalendarSyncFailure[] }> {
  const { boxRoot, calendar, state, calDir } = opts;
  const deleted: string[] = [];
  const notes: SyncNote[] = [];
  const failures: CalendarSyncFailure[] = [];
  const MAX_DELETES = 3;

  for (const [key, entry] of Object.entries(state.eventFiles)) {
    const filename = getFilename(entry);
    // The entry is the authority on the calendar (the key agrees, except for an
    // unattributed legacy entry — which has no calendarId and is skipped below).
    const calendarId = typeof entry === "string" ? undefined : entry.calendarId;
    const { eventId: googleEventId } = parseEventKey(key);
    const filePath = path.join(calDir, filename);

    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch (_e) {
      // File missing — a tracked event with no local file is not a delete request; skip it. The error carries no actionable info beyond the file's absence.
      continue;
    }

    // Check for X-BBX-DELETE property
    const deleteMatch = BBX_DELETE_PATTERN.exec(content);
    if (!deleteMatch) continue;

    const reason = deleteMatch[1]?.trim() || "(no reason)";

    // Extract event summary for the commit message
    const summaryMatch = content.match(/^summary[:;](.*)$/im);
    const summary = summaryMatch?.[1]?.trim() || filename;

    // Extract optional X-BBX-REF
      const refMatch = content.match(/^x-bbx-ref[:;](.*)$/im);
    const ref = refMatch?.[1]?.trim();

    const decision = decideCalendarSync({
      source: "local-delete-marker",
      hasCalendarId: calendarId !== undefined,
      underDeleteCap: deleted.length < MAX_DELETES,
    });
    if (decision.kind === "noop") {
      console.warn(`  Skipping delete of ${filename} — ${decision.reason}`);
      continue;
    }
    invariant(decision.kind === "delete" && calendarId !== undefined, "delete-marker decision must delete with a calendar id");

    console.log(`  Deleting ${filename}: ${reason}`);
    const deleteResult = await deleteEventViaApi(calendar, { calendarId, googleEventId });
    if (deleteResult.ok) {
      await fs.unlink(filePath);
      delete state.eventFiles[key];
      deleted.push(path.relative(boxRoot, filePath));
      const deleteNote: SyncNote = { action: "deleted", summary, detail: reason };
      if (ref) deleteNote.ref = ref;
      notes.push(deleteNote);
    } else {
      // Keep the file (and its X-BBX-DELETE marker) so the next sync retries,
      // and report it — an unrepeatable delete used to retry forever in
      // silence. The delete-cap and missing-calendar-id skips above stay plain
      // warnings: they are deliberate policy, not a stuck request.
      console.warn(`  Failed to delete ${filename} from Google Calendar`);
      failures.push(classifyCalendarFailure(deleteResult.error, {
        calendarId, operation: "local-delete", path: path.relative(boxRoot, filePath),
      }));
    }
  }

  return { deleted, notes, failures };
}
