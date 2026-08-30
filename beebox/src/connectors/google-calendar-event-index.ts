/**
 * The tracked-event index: the shape of one entry, the key it is stored under,
 * and the lookup/migration helpers over the whole map.
 *
 * A Google event id is unique within ONE calendar, not across calendars, so a
 * box syncing two calendars can hold two DIFFERENT events with the same id.
 * Keyed by the bare id, the second calendar's event read as the tracked entry
 * for the first's file — an update or a cancellation on one calendar could
 * overwrite or delete the other's `.ics`. The key is therefore composite:
 *
 *     <eventId> <calendarId>          e.g. "abc123 work@example.com"
 *
 * **The separator is a space and the calendar id comes LAST, deliberately.** A
 * Google event id is base32hex — lowercase `a`–`v` and `0`–`9` — optionally
 * suffixed with `_<instance stamp>` for a recurring instance, so it can never
 * contain whitespace. A calendar id is an address-like string whose full
 * character set we do not control (`me@example.com`,
 * `en.usa#holiday@group.v.calendar.google.com`). Splitting at the FIRST space
 * therefore parses correctly whatever a calendar id turns out to contain, and
 * nothing has to be escaped.
 *
 * Build and read keys through {@link eventKey} / {@link parseEventKey} only —
 * an ad-hoc `${a}:${b}` somewhere is how the two halves drift apart.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { contentHash } from "../lib/content-hash.js";
import { errnoCode } from "../lib/error-guards.js";
import { invariant } from "../lib/invariant.js";

/** Version marker written into the state file once its keys are composite. */
export const EVENT_INDEX_VERSION = 2;

const EVENT_KEY_SEPARATOR = " ";

/**
 * The calendar id a pre-composite-key entry is filed under when it carries no
 * calendar of its own — the legacy plain-filename entries (see
 * {@link EventFileIndex}). It is not a calendar id Google can issue: every real
 * one is an address-like string, and none contains a parenthesis.
 *
 * Such an entry is kept, not dropped. Its filename is what tells
 * `pushAndCleanOrphans` that the `.ics` on disk is already ours; an entry
 * dropped for being unattributable would leave its file untracked, and the next
 * orphan scan would insert a duplicate of it into Google.
 */
const LEGACY_CALENDAR_ID = "(legacy)";

export interface EventFileEntry {
  filename: string;
  calendarId: string;
  /** Hash of the ICS content last written by the connector (for detecting local edits) */
  contentHash?: string;
  /** Google event `updated` timestamp captured at the last pull, for remote-change detection */
  remoteUpdated?: string | undefined;
  /**
   * ISO timestamp of the FIRST push failure for the local edit currently
   * pending on this event — the start of the retry window that ends in
   * stranding (see google-calendar-strand.ts). Left alone by later failures,
   * deleted the moment Google accepts a push. Absent means nothing is owed, or
   * the edit has not yet failed once.
   */
  pendingSince?: string | undefined;
}

/**
 * Composite key → tracked event. A plain string value is the legacy format (the
 * filename alone, from before entries carried metadata); every consumer either
 * skips it or reads only its filename.
 */
export type EventFileIndex = Record<string, string | EventFileEntry>;

/** Get filename from an index entry (handles the legacy string format). */
export function getFilename(entry: string | EventFileEntry): string {
  return typeof entry === "string" ? entry : entry.filename;
}

/** The index key for one event on one calendar. */
export function eventKey(opts: { calendarId: string; eventId: string }): string {
  const { calendarId, eventId } = opts;
  invariant(
    !eventId.includes(EVENT_KEY_SEPARATOR),
    `Google event id ${JSON.stringify(eventId)} contains a space — it cannot be keyed`,
  );
  return `${eventId}${EVENT_KEY_SEPARATOR}${calendarId}`;
}

/**
 * Split an index key back into its halves. A key with no separator has not been
 * through {@link migrateEventIndex} (nothing loaded from disk reaches a caller
 * in that state) and reads as unattributed rather than as a calendar id.
 */
export function parseEventKey(key: string): { calendarId: string; eventId: string } {
  const at = key.indexOf(EVENT_KEY_SEPARATOR);
  if (at === -1) return { calendarId: LEGACY_CALENDAR_ID, eventId: key };
  return { calendarId: key.slice(at + 1), eventId: key.slice(0, at) };
}

/**
 * Find the entry tracking one event on one calendar, with the key it is filed
 * under — the caller needs that key to delete or replace the entry, and it is
 * not always the one {@link eventKey} would build.
 *
 * The fallback is what makes a legacy entry adoptable: it is filed under
 * {@link LEGACY_CALENDAR_ID} because nothing recorded which calendar it came
 * from, so a pull that reaches the same event id matches it here and re-files it
 * under the real calendar. Without that, the pull would write a second entry and
 * leave the legacy one's file behind under its old name — untracked, and
 * re-inserted into Google by the orphan scan.
 */
export function lookupEventEntry(
  index: EventFileIndex,
  opts: { calendarId: string; eventId: string },
): { key: string; entry: string | EventFileEntry } | undefined {
  const key = eventKey(opts);
  const entry = index[key];
  if (entry !== undefined) return { key, entry };
  const legacyKey = eventKey({ calendarId: LEGACY_CALENDAR_ID, eventId: opts.eventId });
  const legacyEntry = index[legacyKey];
  if (legacyEntry !== undefined) return { key: legacyKey, entry: legacyEntry };
  return undefined;
}

/**
 * Bring an index keyed by bare event ids onto composite keys. Idempotent: a key
 * that already carries the separator is passed through untouched, so a
 * half-migrated file (a crash between two saves) converges on the next load.
 *
 * `unattributed` counts the legacy plain-filename entries, which have no
 * calendar to be re-keyed under and land on {@link LEGACY_CALENDAR_ID}.
 */
export function migrateEventIndex(index: EventFileIndex): {
  index: EventFileIndex;
  migrated: number;
  unattributed: number;
} {
  const out: EventFileIndex = {};
  let migrated = 0;
  let unattributed = 0;
  for (const [key, entry] of Object.entries(index)) {
    if (key.includes(EVENT_KEY_SEPARATOR)) {
      out[key] = entry;
      continue;
    }
    migrated++;
    if (typeof entry === "string") {
      unattributed++;
      out[eventKey({ calendarId: LEGACY_CALENDAR_ID, eventId: key })] = entry;
      continue;
    }
    out[eventKey({ calendarId: entry.calendarId, eventId: key })] = entry;
  }
  return { index: out, migrated, unattributed };
}

/**
 * The name to write a tracked event's `.ics` under: the natural one
 * (`{date}_{shortId}.ics`) unless another entry already holds it.
 *
 * The natural name has no calendar in it, so two calendars holding the SAME
 * event id — the ordinary case of one invitation copied into both — on the same
 * date compute the same name. Two entries pointing at one file is the same bug
 * the composite key fixed, one layer down: calendar B's pull rewrites the file,
 * entry A's recorded hash stops matching it, and the pending-edit pass patches
 * calendar A's event with B's content.
 *
 * The disambiguator is a short hash of the calendar id. **A name already
 * disambiguated stays that way** while it still describes the event (same date,
 * same id): otherwise the file would be renamed back and forth in git as its
 * colliding partner is cancelled and re-created. A real rename — the event
 * moved to another day — falls through to a fresh computation, which is the
 * pull's existing rename path.
 *
 * Nothing is renamed on disk by the mere existence of this function, so no
 * rename migration is owed: an event that keeps its date keeps its file.
 */
export function uniqueEventFilename(opts: {
  index: EventFileIndex;
  /**
   * Every key this event is already filed under — its own, plus the legacy key
   * being adopted when there is one. A name one of those holds is not a clash.
   */
  ownKeys: readonly string[];
  calendarId: string;
  /** The natural name for the event as it now stands. */
  filename: string;
  /** The name the entry holds today, when it is already tracked. */
  current?: string | undefined;
}): string {
  const { index, ownKeys, calendarId, filename, current } = opts;
  const stem = filename.endsWith(".ics") ? filename.slice(0, -".ics".length) : filename;
  // Already ours, and still describes this event — keep it (see above).
  if (current !== undefined && (current === filename || current.startsWith(`${stem}_`))) {
    return current;
  }
  const heldByAnother = (name: string): boolean =>
    Object.entries(index).some(([k, entry]) => !ownKeys.includes(k) && getFilename(entry) === name);
  if (!heldByAnother(filename)) return filename;

  const tag = contentHash(calendarId).slice(0, 6);
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = attempt === 0
      ? `${stem}_${tag}.ics`
      : `${stem}_${tag}-${String(attempt + 1)}.ics`;
    if (!heldByAnother(candidate)) return candidate;
  }
  invariant(false, `no free filename for ${filename} on ${calendarId}`);
}

/**
 * Drop entries that share a filename with another, returning what was dropped so
 * the caller can report it.
 *
 * Every pass downstream assumes one file per entry: the pending-edit pass reads
 * a file and patches "the" event it belongs to, and the stale pass deletes a
 * file out from under "the" entry naming it. A box that synced under the old
 * bare-id keys can hold two entries for one file, so the index is deduped once
 * per sync, on the way in.
 *
 * **The keeper is the entry whose recorded hash matches the file's current
 * bytes**, when exactly one does: that entry is the one the file was last
 * written for, and keeping either of the others would leave a hash mismatch that
 * the pending-edit pass reads as an edit and patches into the WRONG calendar's
 * event — the failure this dedupe exists to prevent. When no entry matches, when
 * several do (identical hashes), or when the file cannot be read, there is
 * nothing to choose on and the first entry in index order keeps it.
 *
 * Dropping the others is safe precisely because the file stays tracked by the
 * keeper, so the orphan scan will not re-insert it into Google.
 */
export async function dropDuplicateFilenames(opts: {
  index: EventFileIndex;
  calDir: string;
}): Promise<Array<{ key: string; calendarId: string; filename: string }>> {
  const { index, calDir } = opts;
  const byFilename = new Map<string, string[]>();
  for (const [key, entry] of Object.entries(index)) {
    const filename = getFilename(entry);
    const keys = byFilename.get(filename);
    if (keys) keys.push(key);
    else byFilename.set(filename, [key]);
  }

  const dropped: Array<{ key: string; calendarId: string; filename: string }> = [];
  for (const [filename, keys] of byFilename) {
    const first = keys[0];
    if (keys.length < 2 || first === undefined) continue;
    const keeper = await chooseKeeper({ index, calDir, filename, keys }) ?? first;
    for (const key of keys) {
      if (key === keeper) continue;
      dropped.push({ key, calendarId: parseEventKey(key).calendarId, filename });
      delete index[key];
    }
  }
  return dropped;
}

/** The one entry whose recorded hash matches the file, or undefined if that is not exactly one. */
async function chooseKeeper(opts: {
  index: EventFileIndex;
  calDir: string;
  filename: string;
  keys: string[];
}): Promise<string | undefined> {
  const { index, calDir, filename, keys } = opts;
  let hash: string;
  try {
    hash = contentHash(await fs.readFile(path.join(calDir, filename), "utf-8"));
  } catch (err: unknown) {
    // Gone: no evidence either way, so the caller's order decides. Anything
    // else (permissions, I/O) is a real problem the sync should not paper over.
    if (errnoCode(err) === "ENOENT") return undefined;
    throw err;
  }
  const matches = keys.filter((key) => {
    const entry = index[key];
    return entry !== undefined && typeof entry !== "string" && entry.contentHash === hash;
  });
  return matches.length === 1 ? matches[0] : undefined;
}
