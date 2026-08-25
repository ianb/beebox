/**
 * Post-410 stale-event reconciliation for the Google Calendar connector.
 *
 * One pass, run only after a full-window resync of one calendar succeeds. Leaf
 * module: fs plus the ICS/notes/state helpers, never the connector.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../lib/error-guards.js";
import { icsToGoogleEvent, isInWindow } from "./google-calendar-ics.js";
import { localCalendarFailure } from "./google-calendar-notes.js";
import { type CalendarState } from "./google-calendar-state.js";
import { contentHash } from "../lib/content-hash.js";
import { type SyncAccumulator } from "./google-calendar-sync.js";

/**
 * Post-410 reconciliation: remove events Google no longer has.
 *
 * A full-window list is the complete truth for that window, and it does NOT
 * include deletions (`showDeleted` is not requested), so an event tracked for
 * this calendar and absent from the response was deleted remotely while our
 * sync token was invalid. Google's incremental-sync guidance says to clear the
 * local collection before a full resync; we cannot do that blindly here,
 * because a `.ics` file may hold an unpushed local edit.
 *
 * The three cases, and why:
 *  - **file matches the recorded contentHash** — the connector wrote it and
 *    nobody touched it. Delete the file and untrack it.
 *  - **file edited locally (or an entry with no recorded hash, which we cannot
 *    verify)** — keep the file AND keep tracking it, and report a failure.
 *    Untracking would be worse than doing nothing: `pushAndCleanOrphans` treats
 *    an untracked `.ics` as a locally-created event and would insert the
 *    just-deleted event back into Google. Staying tracked leaves the boxholder
 *    an ordinary way out (edit it, or add X-CB-DELETE), and the failure keeps
 *    the stuck file visible instead of silent.
 *  - **anything outside the refetched window, or that does not parse** — never
 *    touched. It was never in the response's scope, so its absence means
 *    nothing.
 */
export async function removeStaleAfterFullResync(opts: {
  boxRoot: string;
  calDir: string;
  state: CalendarState;
  calendarId: string;
  returnedEventIds: Set<string>;
  windowStart: Date;
  windowEnd: Date;
  acc: SyncAccumulator;
}): Promise<void> {
  const { boxRoot, calDir, state, calendarId, returnedEventIds, windowStart, windowEnd, acc } = opts;

  for (const [eventId, entry] of Object.entries(state.eventFiles)) {
    // Legacy plain-string entries carry no calendar id, so they cannot be
    // attributed to the calendar we just refetched.
    if (typeof entry === "string") continue;
    if (entry.calendarId !== calendarId) continue;
    if (returnedEventIds.has(eventId)) continue;

    const filePath = path.join(calDir, entry.filename);
    const relPath = path.relative(boxRoot, filePath);
    let localContent: string | undefined;
    try {
      localContent = await fs.readFile(filePath, "utf-8");
    } catch (err: unknown) {
      if (errnoCode(err) !== "ENOENT") throw err;
    }
    if (localContent === undefined) {
      // The file is already gone; only the dangling index entry is left.
      delete state.eventFiles[eventId];
      continue;
    }

    const localEvent = icsToGoogleEvent(localContent);
    if (!localEvent) continue;
    if (!isInWindow(localEvent, { start: windowStart, end: windowEnd })) continue;

    const summary = localEvent.summary || entry.filename;
    if (entry.contentHash !== undefined && contentHash(localContent) === entry.contentHash) {
      await fs.unlink(filePath);
      delete state.eventFiles[eventId];
      acc.deleted.push(relPath);
      acc.notes.push({ action: "cancelled", summary });
      continue;
    }

    console.warn(`  ${entry.filename} is no longer on Google but was edited locally — keeping it`);
    acc.notes.push({
      action: "updated",
      summary,
      detail: "no longer on Google, local edit kept",
      ref: relPath,
    });
    acc.failures.push(localCalendarFailure({
      calendarId, operation: "stale-cleanup", path: relPath,
      detail: "locally edited event no longer exists on Google",
    }));
  }
}
