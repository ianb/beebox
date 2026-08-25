/**
 * Stranding — the end of the retry loop for a local edit Google will not take.
 *
 * A tracked `.ics` whose content differs from the hash the connector wrote owes
 * Google a patch, and the mismatch alone is the retry queue: nothing removes it
 * but a push Google accepts. That is a loop with no exit. An event deleted in
 * Google 404s on every future patch, and a locally-edited event missing from a
 * post-410 resync is reported every run forever.
 *
 * Stranding ends it. The file moves to `store/calendar/stranded/` — out of the
 * tracked index, out of the orphan scan's reach (that scan is a non-recursive
 * readdir of `store/calendar` filtered to `.ics`, so it never descends into the
 * subdirectory and cannot re-insert the file as a new Google event), and still
 * on disk with the boxholder's edit intact. The sync says so once, in the
 * commit narrative and in its failure list, and never mentions it again.
 *
 * Leaf module: fs plus the notes/state helpers, never the connector.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { errnoCode } from "../lib/error-guards.js";
import {
  localCalendarFailure,
  type CalendarSyncFailure,
  type CalendarSyncOperation,
  type SyncNote,
} from "./google-calendar-notes.js";
import { type CalendarState } from "./google-calendar-state.js";
import { type EventFileEntry } from "./google-calendar-event-index.js";
import { invariant } from "../lib/invariant.js";

/**
 * How long a transiently-failing push keeps being retried before the event is
 * stranded. Seven days is the boxholder's chosen bound (2026-08-25): long
 * enough to ride out an outage, a revoked-then-restored grant, or a laptop that
 * was closed for a week, and short enough that nothing retries forever.
 */
export const STRANDED_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** Subdirectory of the calendar store that holds stranded `.ics` files. */
export const STRANDED_DIR = "stranded";

/** What the notes and failures a strand produces are collected into. */
export interface StrandAccumulator {
  notes: SyncNote[];
  failures: CalendarSyncFailure[];
  /**
   * Box-root-relative paths a strand touched — the vacated one and the one
   * under `stranded/` — so the sync's path-scoped commit records the move.
   */
  stranded: string[];
}

export type StrandVerdict = { kind: "retry" } | { kind: "strand"; reason: string };

/** The shape of the error, never its message — same discipline as a failure. */
function failureCause(failure: CalendarSyncFailure): string {
  if (failure.httpStatus !== undefined) return `HTTP ${String(failure.httpStatus)}`;
  if (failure.detail !== undefined) return failure.detail;
  return failure.errorKind;
}

function parsedPendingSince(pendingSince: string | undefined): number | undefined {
  if (pendingSince === undefined) return undefined;
  const parsed = Date.parse(pendingSince);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Retry this failed push, or give up on it?
 *
 * **Definitive** — a 404 or 410 on the patch. The event is not there to patch:
 * no number of retries changes that, so the window is not waited out.
 *
 * **Transient** — everything else (429, 5xx, a network error, any other 4xx, a
 * local `.ics` that will not parse). Retried on every wakeup until the edit has
 * been pending {@link STRANDED_AFTER_MS}; the first run after that strands it.
 *
 * An unreadable `pendingSince` is treated as no stamp at all —
 * {@link markPushPending} rewrites it, so the window restarts rather than
 * never elapsing.
 */
export function classifyPushFailure(opts: {
  failure: CalendarSyncFailure;
  pendingSince: string | undefined;
  now: Date;
}): StrandVerdict {
  const { failure, pendingSince, now } = opts;
  const status = failure.httpStatus;
  if (status === 404 || status === 410) {
    return { kind: "strand", reason: `deleted on Google (HTTP ${String(status)})` };
  }
  const since = parsedPendingSince(pendingSince);
  if (since !== undefined && now.getTime() - since >= STRANDED_AFTER_MS) {
    return {
      kind: "strand",
      reason: `not pushed for 7 days: ${failureCause(failure)}`,
    };
  }
  return { kind: "retry" };
}

/**
 * Start (or leave running) the retry window for an edit Google has not taken.
 * The first failure stamps it; later failures leave the stamp alone, which is
 * what makes the window measure the edit's age rather than this run's.
 */
export function markPushPending(entry: EventFileEntry, now: Date): void {
  if (parsedPendingSince(entry.pendingSince) !== undefined) return;
  entry.pendingSince = now.toISOString();
}

/** SUMMARY straight out of the file, for a note about content we can't push. */
export function icsSummary(content: string, fallback: string): string {
  const match = content.match(/^summary[:;](.*)$/im);
  return match?.[1]?.trim() || fallback;
}

/**
 * Move a file into `stranded/` under a name nothing else holds.
 *
 * `link` + `unlink` rather than `rename`, because rename overwrites silently:
 * a check-then-rename would let one stranding clobber an earlier stranded edit
 * that took the same name in between. `link` fails EEXIST instead, so the loop
 * walks to the next suffix and no boxholder edit is ever destroyed. Returns the
 * path the file now lives at; ENOENT (the source went away) propagates to the
 * caller, which owns that case.
 */
async function moveWithoutOverwriting(opts: {
  from: string;
  strandedDir: string;
  filename: string;
}): Promise<string> {
  const { from, strandedDir, filename } = opts;
  const ext = path.extname(filename);
  const stem = filename.slice(0, filename.length - ext.length);
  // A hundred strandings of the same filename is not a case worth a failure
  // mode of its own: the last candidate is an unmistakable unique name.
  const candidates = [
    ...Array.from({ length: 100 }, (_unused, index) =>
      index === 0 ? filename : `${stem}-${String(index + 1)}${ext}`),
    `${stem}-${randomUUID().slice(0, 8)}${ext}`,
  ];
  for (const candidate of candidates) {
    const target = path.join(strandedDir, candidate);
    try {
      await fs.link(from, target);
    } catch (err: unknown) {
      if (errnoCode(err) === "EEXIST") continue;
      throw err;
    }
    await fs.unlink(from);
    return target;
  }
  invariant(false, `no free name for ${filename} in ${strandedDir}`);
}

/**
 * Move one event's file into `stranded/`, untrack it, and say so once.
 *
 * Untracking and moving happen together on purpose: an untracked `.ics` left in
 * `store/calendar/` is a locally-created event to the next run's orphan scan,
 * which would insert it into Google as a brand-new duplicate. So a move that
 * fails for any reason other than the file already being gone leaves the entry
 * tracked — the run reports the failure and tries again next time — rather than
 * untracking a file still sitting where the orphan scan will find it.
 */
export async function strandEntry(opts: {
  boxRoot: string;
  calDir: string;
  state: CalendarState;
  /** The event's index key — see google-calendar-event-index.ts. */
  key: string;
  entry: EventFileEntry;
  summary: string;
  reason: string;
  operation: CalendarSyncOperation;
  acc: StrandAccumulator;
}): Promise<void> {
  const { boxRoot, calDir, state, key, entry, summary, reason, operation, acc } = opts;
  const from = path.join(calDir, entry.filename);
  const fromRel = path.relative(boxRoot, from);

  const strandedDir = path.join(calDir, STRANDED_DIR);
  await fs.mkdir(strandedDir, { recursive: true });

  let to: string;
  try {
    to = await moveWithoutOverwriting({ from, strandedDir, filename: entry.filename });
  } catch (err: unknown) {
    if (errnoCode(err) !== "ENOENT") {
      console.warn(`  Could not move ${entry.filename} to ${STRANDED_DIR}/, keeping it tracked:`, err);
      acc.failures.push(localCalendarFailure({
        calendarId: entry.calendarId, operation, path: fromRel,
        detail: `could not move to ${STRANDED_DIR}/`,
      }));
      return;
    }
    // Nothing left to preserve — the file went away under us. Untrack it and
    // report the strand anyway, so the entry does not linger as a dangling one.
    delete state.eventFiles[key];
    acc.stranded.push(fromRel);
    acc.notes.push({ action: "stranded", summary, detail: reason });
    return;
  }

  const toRel = path.relative(boxRoot, to);
  delete state.eventFiles[key];
  acc.stranded.push(fromRel, toRel);
  console.warn(`  Stranded ${entry.filename} — ${reason}; moved to ${STRANDED_DIR}/`);
  acc.notes.push({ action: "stranded", summary, detail: reason, ref: toRel });
  acc.failures.push(localCalendarFailure({
    calendarId: entry.calendarId, operation, path: fromRel,
    detail: `stranded — ${reason}`,
  }));
}

/**
 * The one place a failed local-edit push decides what happens next, shared by
 * the pull's local-wins path and the pending-edit pass. Either the edit keeps
 * its place in the retry queue (its `pendingSince` stamp started or standing,
 * the failure reported so the stuck file stays visible) or it is stranded.
 */
export async function recordFailedLocalPush(opts: {
  boxRoot: string;
  calDir: string;
  state: CalendarState;
  /** The event's index key — see google-calendar-event-index.ts. */
  key: string;
  entry: EventFileEntry;
  localContent: string;
  failure: CalendarSyncFailure;
  now: Date;
  acc: StrandAccumulator;
}): Promise<void> {
  const { boxRoot, calDir, state, key, entry, localContent, failure, now, acc } = opts;
  const verdict = classifyPushFailure({ failure, pendingSince: entry.pendingSince, now });
  if (verdict.kind === "retry") {
    markPushPending(entry, now);
    acc.failures.push(failure);
    return;
  }
  await strandEntry({
    boxRoot, calDir, state, key, entry,
    summary: icsSummary(localContent, entry.filename),
    reason: verdict.reason, operation: "local-push", acc,
  });
}
