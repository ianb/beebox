/**
 * Google Calendar local-file push/delete passes.
 *
 * Reconciles the box's .ics files *toward* Google: pushes locally-created
 * untracked files, cleans unparseable orphans, and honors X-CB-DELETE markers.
 * Counterpart to google-calendar-sync.ts (which pulls from Google). Leaf
 * module — depends only on the ICS, notes, and state helpers.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { type GoogleCalendarService } from "../services/google-calendar.js";
import { validateIcsTimezone } from "./calendar-utils.js";
import { icsToGoogleEvent } from "./google-calendar-ics.js";
import {
  formatEventDate,
  extractCbAnnotations,
  type SyncNote,
} from "./google-calendar-notes.js";
import {
  getFilename,
  deleteEventViaApi,
  insertEventViaApi,
  type CalendarState,
} from "./google-calendar-state.js";

/**
 * Push locally-created .ics files (not tracked in state) to Google Calendar,
 * then track them. Returns { pushed, deleted, notes } arrays.
 */
export async function pushAndCleanOrphans(
  opts: { boxRoot: string; calendar: GoogleCalendarService; state: CalendarState; calDir: string; defaultCalendarId: string },
): Promise<{ pushed: string[]; deleted: string[]; notes: SyncNote[] }> {
  const { boxRoot, calendar, state, calDir, defaultCalendarId } = opts;
  const pushed: string[] = [];
  const deleted: string[] = [];
  const notes: SyncNote[] = [];
  const trackedFiles = new Set<string>();
  for (const entry of Object.values(state.eventFiles)) {
    trackedFiles.add(getFilename(entry));
  }

  let files: string[];
  try {
    files = await fs.readdir(calDir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err as Error;
    return { pushed, deleted, notes };
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

      // Validate timezone on non-all-day events
      const tzError = validateIcsTimezone(content);
      if (tzError) {
        console.warn(`  Skipping ${file}: ${tzError}`);
        continue;
      }

      // Extract and strip annotations before pushing
      const { reason, ref, stripped } = extractCbAnnotations(content);

      // Determine target calendar from X-CB-CALENDAR-ID or use default
      const calendarId = apiEvent._calendarId || defaultCalendarId;
      // Remove our internal field before sending to API
      delete apiEvent._calendarId;

      const result = await insertEventViaApi(calendar, { calendarId, event: apiEvent });
      if (result) {
        // Track the file with its new Google event ID
        state.eventFiles[result.id] = { filename: file, calendarId };
        pushed.push(relPath);

        // Write back stripped content (without annotations)
        if (reason || ref) {
          await fs.writeFile(filePath, stripped);
        }

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
        // Push failed — leave the file alone (don't delete it)
        console.warn(`  Failed to push ${file}, keeping locally`);
      }
    } catch (err: unknown) {
      console.warn(`  Error processing ${file}:`, err);
    }
  }

  return { pushed, deleted, notes };
}

/**
 * Scan tracked .ics files for X-CB-DELETE property. If found, delete the
 * event from Google Calendar, remove the local file, and untrack it.
 * Safety cap: at most 3 deletes per sync. Skips read-only calendars.
 */
export async function processLocalDeletes(
  opts: { boxRoot: string; calendar: GoogleCalendarService; state: CalendarState; calDir: string },
): Promise<{ deleted: string[]; notes: SyncNote[] }> {
  const { boxRoot, calendar, state, calDir } = opts;
  const deleted: string[] = [];
  const notes: SyncNote[] = [];
  const MAX_DELETES = 3;

  for (const [googleEventId, entry] of Object.entries(state.eventFiles)) {
    const filename = getFilename(entry);
    const calendarId = typeof entry === "string" ? undefined : entry.calendarId;
    const filePath = path.join(calDir, filename);

    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch (_e) {
      // File missing — a tracked event with no local file is not a delete request; skip it. The error carries no actionable info beyond the file's absence.
      continue;
    }

    // Check for X-CB-DELETE property
    const deleteMatch = content.match(/^x-cb-delete[:;](.*)$/im);
    if (!deleteMatch) continue;

    const reason = deleteMatch[1]?.trim() || "(no reason)";

    // Extract event summary for the commit message
    const summaryMatch = content.match(/^summary[:;](.*)$/im);
    const summary = summaryMatch?.[1]?.trim() || filename;

    // Extract optional X-CB-REF
    const refMatch = content.match(/^x-cb-ref[:;](.*)$/im);
    const ref = refMatch?.[1]?.trim();

    if (deleted.length >= MAX_DELETES) {
      console.warn(`  Skipping delete of ${filename} — reached limit of ${MAX_DELETES} deletes per sync`);
      continue;
    }

    if (!calendarId) {
      console.warn(`  Skipping delete of ${filename} — no calendar ID in state`);
      continue;
    }

    console.log(`  Deleting ${filename}: ${reason}`);
    // Capture ICS content before deleting for calendar-review job
    let icsContent: string | undefined;
    try {
      icsContent = await fs.readFile(filePath, "utf-8");
    } catch (_e) {
      // File already gone — icsContent stays undefined; capture is best-effort for the review job, the deleteEvent/unlink below handle the real deletion.
    }
    const success = await deleteEventViaApi(calendar, { calendarId, googleEventId });
    if (success) {
      await fs.unlink(filePath);
      delete state.eventFiles[googleEventId];
      deleted.push(path.relative(boxRoot, filePath));
      const deleteNote: SyncNote = { action: "deleted", summary, detail: reason };
      if (icsContent) deleteNote.icsContent = icsContent;
      if (ref) deleteNote.ref = ref;
      notes.push(deleteNote);
    } else {
      console.warn(`  Failed to delete ${filename} from Google Calendar`);
    }
  }

  return { deleted, notes };
}
