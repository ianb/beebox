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
import { type CalendarState } from "./google-calendar-state.js";
import { strandEntry } from "./google-calendar-strand.js";
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
 *    verify)** — strand it: the file moves to `stranded/`, the entry goes away,
 *    and the run says so once. The edit cannot be pushed (the event is gone
 *    from Google), so retrying it forever only re-reports the same stuck file.
 *    It may not simply be untracked in place either — `pushAndCleanOrphans`
 *    reads an untracked `.ics` as a locally-created event and would insert the
 *    just-deleted event back into Google — and moving it out of that scan's
 *    reach is what makes untracking safe.
 *  - **anything outside the refetched window, or that does not parse** — never
 *    touched. It was never in the response's scope, so its absence means
 *    nothing.
 *  - **a recurring master (the `.ics` carries an RRULE)** — never touched
 *    either. We list with `singleEvents=false` and a `timeMin`/`timeMax`, and
 *    which masters that combination returns is a Google-side judgement about
 *    where a series' instances fall, not something absence can be read as
 *    deletion of: a series whose instances have all drifted out of the window
 *    is simply not returned. `isInWindow` cannot arbitrate — it answers `true`
 *    for every recurring event by construction — so the only safe reading of a
 *    missing master is "no information". A series really deleted in Google
 *    comes back as a cancelled event on an ordinary pull, or is cleaned up by
 *    hand with X-CB-DELETE.
 */
export async function removeStaleAfterFullResync(opts: {
  boxRoot: string;
  calDir: string;
  state: CalendarState;
  calendarId: string;
  /** Index keys (`<eventId> <calendarId>`) Google returned for THIS calendar. */
  returnedEventKeys: Set<string>;
  windowStart: Date;
  windowEnd: Date;
  acc: SyncAccumulator;
}): Promise<void> {
  const { boxRoot, calDir, state, calendarId, returnedEventKeys, windowStart, windowEnd, acc } = opts;

  for (const [key, entry] of Object.entries(state.eventFiles)) {
    // Legacy plain-string entries carry no calendar id, so they cannot be
    // attributed to the calendar we just refetched.
    if (typeof entry === "string") continue;
    if (entry.calendarId !== calendarId) continue;
    if (returnedEventKeys.has(key)) continue;

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
      delete state.eventFiles[key];
      continue;
    }

    const localEvent = icsToGoogleEvent(localContent);
    if (!localEvent) continue;
    if (localEvent.recurrence && localEvent.recurrence.length > 0) continue;
    if (!isInWindow(localEvent, { start: windowStart, end: windowEnd })) continue;

    const summary = localEvent.summary || entry.filename;
    if (entry.contentHash !== undefined && contentHash(localContent) === entry.contentHash) {
      await fs.unlink(filePath);
      delete state.eventFiles[key];
      acc.deleted.push(relPath);
      acc.notes.push({ action: "cancelled", summary });
      continue;
    }

    // The edit can never be pushed — there is nothing on Google to patch — so
    // it is stranded rather than kept tracked. Keeping it tracked used to be
    // the least-bad option: untracking leaves an `.ics` the orphan scan reads
    // as locally-created and inserts back into Google. Stranding gets the same
    // protection by MOVING the file out of the orphan scan's reach, and ends
    // the retry loop that reported the same stuck file on every later run.
    await strandEntry({
      boxRoot, calDir, state, key, entry, summary,
      reason: "deleted on Google (absent from a full resync)",
      operation: "stale-cleanup", acc,
    });
  }
}
