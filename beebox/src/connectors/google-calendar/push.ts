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
import { contentHash } from "../../lib/content-hash.js";
import { type GoogleCalendarService } from "../../services/google-calendar/core.js";
import { validateIcsTimezone } from "./utils.js";
import { listIcsFiles } from "./calendar-folders.js";
import { icsToGoogleEvent } from "./ics.js";
import { decideCalendarSync } from "./decide.js";
import { invariant } from "../../shared/invariant.js";
import {
  BBX_DELETE_PATTERN,
  formatEventDate,
  extractBbxAnnotations,
  classifyCalendarFailure,
  localCalendarFailure,
  type CalendarSyncFailure,
  type SyncNote,
} from "./notes.js";
import {
  deleteEventViaApi,
  insertEventViaApi,
  type CalendarState,
} from "./state.js";
import {
  entryCalendarId,
  eventKey,
  getFilename,
  parseEventKey,
  type EventFileEntry,
} from "./event-index.js";

interface OrphanAccumulator {
  pushed: string[];
  deleted: string[];
  notes: SyncNote[];
  failures: CalendarSyncFailure[];
}

/**
 * Push locally-created .ics files (not tracked in state) to Google Calendar,
 * then track them. Returns { pushed, deleted, notes, failures }.
 *
 * Each calendar folder is scanned on its own and its files go to its
 * calendar: the folder is how a person or agent picks the calendar. A file
 * directly in `_content/calendar/` belongs to no calendar and is reported, not
 * pushed. The scans are flat, deliberately: they must NOT descend into a
 * `stranded/` folder, whose `.ics` files are edits given up on
 * (google-calendar-strand.ts) and would be read here as locally-created events
 * and inserted into Google.
 *
 * Every way a file can fail to reach Google — a rejected insert, an
 * unusable timezone, an unexpected per-file error — produces a
 * CalendarSyncFailure. These used to be console warnings only, so a file that
 * could never be pushed retried forever while the sync reported success.
 */
export async function pushAndCleanOrphans(
  opts: { boxRoot: string; calendar: GoogleCalendarService; state: CalendarState; calRoot: string; folders: ReadonlyMap<string, string> },
): Promise<OrphanAccumulator> {
  const { boxRoot, calendar, state, calRoot, folders } = opts;
  const acc: OrphanAccumulator = { pushed: [], deleted: [], notes: [], failures: [] };

  for (const file of await listIcsFiles(calRoot)) {
    acc.failures.push(localCalendarFailure({
      calendarId: "(none)", operation: "local-push", path: path.relative(boxRoot, path.join(calRoot, file)),
      detail: "not in a calendar folder; move it into the attach folder of the calendar it belongs to",
    }));
  }

  for (const [calendarId, calDir] of folders) {
    // Also what keeps this pass from ever needing uniqueEventFilename: a file it
    // pushes is one no entry of this calendar names, so tracking it under its
    // on-disk name cannot collide with another entry's file.
    const trackedFiles = new Set<string>();
    for (const [key, entry] of Object.entries(state.eventFiles)) {
      if (entryCalendarId(key, entry) === calendarId) trackedFiles.add(getFilename(entry));
    }
    for (const file of await listIcsFiles(calDir)) {
      if (trackedFiles.has(file)) continue;
      const filePath = path.join(calDir, file);
      try {
        await pushOrphan({ boxRoot, calendar, state, calendarId, file, filePath, acc });
      } catch (err: unknown) {
        console.warn(`  Error processing ${file}:`, err);
        acc.failures.push(classifyCalendarFailure(err, {
          calendarId, operation: "local-push", path: path.relative(boxRoot, filePath),
        }));
      }
    }
  }

  return acc;
}

/** Insert one untracked file into its folder's calendar, or report why not. */
async function pushOrphan(opts: {
  boxRoot: string; calendar: GoogleCalendarService; state: CalendarState;
  calendarId: string; file: string; filePath: string; acc: OrphanAccumulator;
}): Promise<void> {
  const { boxRoot, calendar, state, calendarId, file, filePath, acc } = opts;
  const relPath = path.relative(boxRoot, filePath);
  const content = await fs.readFile(filePath, "utf-8");
  const apiEvent = icsToGoogleEvent(content);
  if (!apiEvent) {
    // Unparseable — delete orphan
    await fs.unlink(filePath);
    acc.deleted.push(relPath);
    return;
  }

  // Validate timezone on non-all-day events. Unfixable without a human
  // editing the file, so it is a failure rather than a silent skip.
  const tzError = validateIcsTimezone(content);
  if (tzError) {
    console.warn(`  Skipping ${file}: ${tzError}`);
    acc.failures.push(classifyCalendarFailure(new Error(tzError), {
      calendarId, operation: "local-push", path: relPath,
    }));
    return;
  }

  // The folder decides the calendar. A file that names a different one is
  // ambiguous about where the person meant it to go, so it waits for them.
  if (apiEvent._calendarId !== undefined && apiEvent._calendarId !== calendarId) {
    acc.failures.push(localCalendarFailure({
      calendarId, operation: "local-push", path: relPath,
      detail: "X-BBX-CALENDAR-ID names another calendar; move the file to that calendar's folder or remove the line",
    }));
    return;
  }
  // Remove our internal field before sending to API
  delete apiEvent._calendarId;

  // Extract and strip annotations before pushing
  const { reason, ref, stripped } = extractBbxAnnotations(content);

  const result = await insertEventViaApi(calendar, { calendarId, event: apiEvent });
  if (!result.ok) {
    // Push failed — leave the file alone (don't delete it) so the next
    // sync retries, and report the failure so the retry loop is visible.
    console.warn(`  Failed to push ${file}, keeping locally`);
    acc.failures.push(classifyCalendarFailure(result.error, {
      calendarId, operation: "local-push", path: relPath,
    }));
    return;
  }

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
      acc.failures.push(classifyCalendarFailure(err, {
        calendarId, operation: "local-push", path: relPath,
      }));
    }
  }
  acc.pushed.push(relPath);

  // Build push note
  const dateStr = formatEventDate(apiEvent);
  const pushNote: SyncNote = {
    action: "pushed",
    summary: `${apiEvent.summary || file}${dateStr ? ` (${dateStr})` : ""}`,
  };
  if (reason) pushNote.detail = reason;
  if (ref) pushNote.ref = ref;
  acc.notes.push(pushNote);
}

/**
 * Scan tracked .ics files for X-BBX-DELETE property. If found, delete the
 * event from Google Calendar, remove the local file, and untrack it.
 * Safety cap: at most 3 deletes per sync. Skips read-only calendars.
 */
export async function processLocalDeletes(
  opts: { boxRoot: string; calendar: GoogleCalendarService; state: CalendarState; folders: ReadonlyMap<string, string> },
): Promise<{ deleted: string[]; notes: SyncNote[]; failures: CalendarSyncFailure[] }> {
  const { boxRoot, calendar, state, folders } = opts;
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
    // A calendar with no folder is reported by the connector; nothing to read.
    const calDir = folders.get(entryCalendarId(key, entry));
    if (calDir === undefined) continue;
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
