/**
 * One calendar's pull, with 410 (expired sync token) recovery.
 *
 * Split out of the connector so the class keeps to config, state, and the
 * commit: this is the per-calendar orchestration around the sync engine —
 * incremental attempt, full-window retry, post-resync stale reconciliation —
 * and the token bookkeeping each outcome demands. Leaf module.
 */

import { HTTPError } from "ky";
import { type GoogleCalendarService } from "../services/google-calendar.js";
import {
  classifyCalendarFailure,
  type CalendarSyncFailure,
  type SyncNote,
} from "./google-calendar-notes.js";
import {
  saveCalendarState,
  type CalendarState,
  type IcsOptions,
  type SyncTokenSnapshot,
} from "./google-calendar-state.js";
import { removeStaleAfterFullResync } from "./google-calendar-stale.js";
import { syncCalendar, type SyncAccumulator } from "./google-calendar-sync.js";

type CalendarSyncOutcome =
  | { kind: "synced"; fullResync: boolean }
  | { kind: "failed"; failure: CalendarSyncFailure };

function emptySyncAccumulator(): SyncAccumulator {
  return {
    created: [], updated: [], deleted: [], notes: [], failures: [],
    reconciledEventIds: new Set(), seenEventIds: new Set(),
  };
}

/**
 * Sync one calendar, retrying with a full sync if the sync token expired (410).
 * Accumulates every completed write into `acc`. Ordinary failures restore
 * the incoming token; a failed 410 recovery leaves the invalid token absent.
 */
export async function runCalendarSync(opts: {
  boxRoot: string;
  calendar: GoogleCalendarService;
  calendarId: string;
  syncToken: string | undefined;
  icsOpts: IcsOptions;
  state: CalendarState;
  calDir: string;
  syncDaysBack: number;
  syncDaysForward: number;
  windowStart: Date;
  windowEnd: Date;
  snapshot: SyncTokenSnapshot;
  acc: {
    created: string[]; updated: string[]; deleted: string[];
    allNotes: SyncNote[]; failures: CalendarSyncFailure[]; reconciledEventIds: Set<string>;
  };
}): Promise<CalendarSyncOutcome> {
  const { boxRoot, calendar, calendarId, syncToken, icsOpts, state, calDir,
          syncDaysBack, syncDaysForward, windowStart, windowEnd, snapshot, acc } = opts;
  const saveState = async (): Promise<void> =>
    saveCalendarState(boxRoot, { state, snapshot });
  const base = {
    boxRoot, calendar, calendarId, syncDaysBack, syncDaysForward,
    state, icsOpts, calDir, windowStart, windowEnd,
  };
  const collect = (r: SyncAccumulator, opts2: { withNotes: boolean; withFailures: boolean }): void => {
    acc.created.push(...r.created);
    acc.updated.push(...r.updated);
    acc.deleted.push(...r.deleted);
    // Always union the reconciled ids, even for a discarded 410 attempt: the
    // pull DID look at those events, so the pending pass has nothing to add.
    for (const id of r.reconciledEventIds) acc.reconciledEventIds.add(id);
    if (opts2.withNotes) acc.allNotes.push(...r.notes);
    // A 410 discards the attempt's failures: the full resync that follows
    // re-runs every one of those events, so keeping them would double-report.
    if (opts2.withFailures) acc.failures.push(...r.failures);
  };

  const firstAttempt = emptySyncAccumulator();
  try {
    await syncCalendar({ ...base, syncToken, acc: firstAttempt });
    collect(firstAttempt, { withNotes: true, withFailures: true });
    return { kind: "synced", fullResync: false };
  } catch (err: unknown) {
    const expiredToken = err instanceof HTTPError && err.response.status === 410;
    collect(firstAttempt, { withNotes: true, withFailures: !expiredToken });
    if (!expiredToken) {
      if (syncToken === undefined) delete state.syncTokens[calendarId];
      else state.syncTokens[calendarId] = syncToken;
      await saveState();
      return {
        kind: "failed",
        failure: classifyCalendarFailure(err, {
          calendarId,
          operation: "incremental-sync",
        }),
      };
    }
  }

  console.log(`  Sync token expired for ${calendarId}, doing full sync...`);
  delete state.syncTokens[calendarId];
  await saveState();

  const fullAttempt = emptySyncAccumulator();
  try {
    await syncCalendar({ ...base, syncToken: undefined, acc: fullAttempt });
    // Don't add individual notes for a successful full re-sync — the commit
    // message summarizes the refresh.
    collect(fullAttempt, { withNotes: false, withFailures: true });
    // The full response is the complete truth for this window, and it does
    // not report deletions — so anything we still track and it didn't return
    // is gone from Google. Only reachable after a SUCCESSFUL full fetch: a
    // partial one would read as "everything was deleted".
    const staleAcc = emptySyncAccumulator();
    await removeStaleAfterFullResync({
      boxRoot, calDir, state, calendarId,
      returnedEventIds: fullAttempt.seenEventIds, windowStart, windowEnd, acc: staleAcc,
    });
    collect(staleAcc, { withNotes: true, withFailures: true });
    return { kind: "synced", fullResync: true };
  } catch (err: unknown) {
    collect(fullAttempt, { withNotes: true, withFailures: true });
    delete state.syncTokens[calendarId];
    await saveState();
    return {
      kind: "failed",
      failure: classifyCalendarFailure(err, {
        calendarId,
        operation: "full-sync",
      }),
    };
  }
}
