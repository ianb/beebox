/**
 * Google Calendar Connector — Syncs calendar events as .ics files.
 *
 * Configuration:
 *   config/connectors/google-calendar.json       - { "calendars": ["primary"], "syncDaysBack": 30, "syncDaysForward": 90 }
 *   config/connectors/google-calendar-state.json  - { syncTokens, eventFiles }
 *   config/connectors/google.secret.json          - shared Google OAuth2 credentials
 *
 * Events are stored as individual .ics files in store/calendar/.
 * Uses singleEvents=false so recurring events are returned as compact masters
 * with RRULEs (expanded at query time by calendar-utils.ts).
 * Exception instances (single overrides of recurring events) are skipped.
 * Incremental sync may return events outside the time window, so we filter
 * client-side. Filename format: {YYYY-MM-DD}_{shortId}.ics
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  registerConnector,
  type Connector,
  type SyncResult,
} from "./index.js";
import { getGoogleAuth } from "./google-auth.js";
import { createGoogleAuthService } from "../services/google-auth.js";
import { getBoxTime } from "../lib/time.js";
import {
  createGoogleCalendarService,
  type GoogleCalendarService,
} from "../services/google-calendar.js";
import { isGoogleServiceAllowed } from "../core/box/config.js";
import {
  loadCalendarConfig,
  saveCalendarConfig,
  fetchAvailableCalendars,
  type CalendarConfig,
} from "./calendar-config.js";
import { stageAndCommitPaths } from "../lib/git.js";
import {
  buildNarrativeCommitMessage,
  formatCalendarSyncFailure,
  localCalendarFailure,
  type CalendarSyncFailure,
  type SyncNote,
} from "./google-calendar-notes.js";
import {
  calendarStatePath,
  calendarDir,
  loadCalendarState,
  saveCalendarState,
  CalendarStateCorruptError,
  type CalendarState,
  type IcsOptions,
  type SyncTokenSnapshot,
} from "./google-calendar-state.js";
import { runCalendarSync } from "./google-calendar-run.js";
import { pushAndCleanOrphans, processLocalDeletes } from "./google-calendar-push.js";
import { pushPendingLocalEdits } from "./google-calendar-local-push.js";
import { dropDuplicateFilenames } from "./google-calendar-event-index.js";
import { assertNever } from "../lib/invariant.js";

interface GoogleCalendarConnectorOptions {
  /** Injected calendar service (tests); the real one is built from box auth when omitted. */
  calendar?: GoogleCalendarService;
  /**
   * Clock for the sync time-window. Injectable so the window isn't tied to wall
   * time — tests freeze it so fixed-date fixtures stay in-window regardless of
   * when the suite runs. Defaults to `() => new Date()` in production.
   */
  now?: () => Date;
}

class GoogleCalendarConnector implements Connector {
  name = "google-calendar";
  produces = ["calendar-event"];
  inboxPaths: string[] = [];
  triggeredBy?: string;

  private boxRoot: string;
  private injectedService?: GoogleCalendarService | undefined;
  private now: () => Date;

  constructor(boxRoot: string, options?: GoogleCalendarConnectorOptions) {
    this.boxRoot = boxRoot;
    this.injectedService = options?.calendar;
    // Domain time by default (scenario-frozen via CB_TIME/stubs) — the sync
    // window is deterministic under a frozen clock; tests can still inject `now`.
    this.now = options?.now ?? (() => getBoxTime(this.boxRoot));
  }

  private async getCalendar(): Promise<GoogleCalendarService | null> {
    if (this.injectedService) return this.injectedService;
    const auth = await getGoogleAuth(this.boxRoot);
    if (!auth) return null;
    return createGoogleCalendarService(createGoogleAuthService(auth, { boxRoot: this.boxRoot }));
  }

  private statePath(): string {
    return calendarStatePath(this.boxRoot);
  }

  private calendarDir(): string {
    return calendarDir(this.boxRoot);
  }

  private async loadConfig(): Promise<CalendarConfig> {
    return loadCalendarConfig(this.boxRoot);
  }

  private async loadState(): Promise<CalendarState> {
    return loadCalendarState(this.boxRoot);
  }

  /**
   * Persist state. `snapshot` is the per-sync mutable delta baseline for the
   * transient syncTokens side (see SyncTokenSnapshot) — saveCalendarState
   * merges against it and advances it to this save.
   */
  private async saveState(state: CalendarState, snapshot: SyncTokenSnapshot): Promise<void> {
    return saveCalendarState(this.boxRoot, { state, snapshot });
  }

  async sync(): Promise<SyncResult> {
    // Skip policy check when a fake service is injected (tests).
    if (!this.injectedService) {
      const allowed = await isGoogleServiceAllowed(this.boxRoot, "calendar");
      if (!allowed) {
        return { success: true, created: [], updated: [] };
      }
    }

    const calendar = await this.getCalendar();
    if (!calendar) {
      return { success: true, created: [], updated: [] };
    }

    const config = await this.loadConfig();
    let state: CalendarState;
    try {
      state = await this.loadState();
    } catch (err: unknown) {
      // A present-but-unreadable event index would make every local .ics look
      // locally-created; abort before the push pass can duplicate them all
      // into Google. See CalendarStateCorruptError.
      if (!(err instanceof CalendarStateCorruptError)) throw err;
      console.error(err.message);
      return { success: false, created: [], updated: [], error: err.message };
    }
    // Per-sync delta baseline for the transient syncTokens (advanced by each
    // save — see SyncTokenSnapshot in google-calendar-state.ts).
    const snapshot: SyncTokenSnapshot = { tokens: { ...state.syncTokens } };
    const calendars = config.calendars || ["primary"];
    const syncDaysBack = config.syncDaysBack ?? 30;
    const syncDaysForward = config.syncDaysForward ?? 90;

    // Fetch calendar metadata and cache names/roles
    const available = await fetchAvailableCalendars(calendar);
    const calendarNames: Record<string, string> = {};
    const calendarRoles: Record<string, string> = {};
    for (const cal of available) {
      calendarNames[cal.id] = cal.summary;
      calendarRoles[cal.id] = cal.accessRole;
      if (cal.primary) {
        calendarNames["primary"] = cal.summary;
        calendarRoles["primary"] = cal.accessRole;
      }
    }
    await saveCalendarConfig(this.boxRoot, {
      ...config,
      calendarNames,
      calendarRoles,
    });

    const icsOptsFor = (calendarId: string): IcsOptions => {
      const opts: IcsOptions = { calendarId };
      if (calendarNames[calendarId]) opts.calendarName = calendarNames[calendarId];
      if (calendarRoles[calendarId]) opts.calendarRole = calendarRoles[calendarId];
      return opts;
    };

    const calDir = this.calendarDir();
    await fs.mkdir(calDir, { recursive: true });

    // Time window for client-side filtering (incremental sync can return
    // events outside our window, e.g. all instances of a recurring event)
    const now = this.now();
    const windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() - syncDaysBack);
    const windowEnd = new Date(now);
    windowEnd.setDate(windowEnd.getDate() + syncDaysForward);

    const created: string[] = [];
    const updated: string[] = [];
    const deleted: string[] = [];
    // Paths a stranding moved — the vacated one and its new home under
    // store/calendar/stranded/. Kept apart from created/updated/deleted so the
    // path-scoped commit records the move without the sync claiming it as an
    // event it created or updated.
    const stranded: string[] = [];
    const allNotes: SyncNote[] = [];
    const failures: CalendarSyncFailure[] = [];
    // One file per entry is what every pass below assumes. A box that synced
    // under the old bare-id keys can hold two entries for one file; the ones
    // that lose the file are untracked here and reported, rather than left to
    // have their event patched with the keeper's content.
    for (const dup of await dropDuplicateFilenames({ index: state.eventFiles, calDir })) {
      console.warn(`  Untracked ${dup.key} — store/calendar/${dup.filename} belongs to another entry`);
      failures.push(localCalendarFailure({
        calendarId: dup.calendarId, operation: "stale-cleanup",
        path: `store/calendar/${dup.filename}`,
        detail: "two tracked events named one file; this entry was untracked",
      }));
    }
    let isFullResync = false;
    // Union across calendars of the events this run's pull (or its post-410
    // stale pass) already handled, as index keys — what the pending-edit pass
    // must not touch.
    const reconciledEventKeys = new Set<string>();

    for (const calendarId of calendars) {
      const existingSyncToken = state.syncTokens[calendarId];

      const outcome = await runCalendarSync({
        boxRoot: this.boxRoot, calendar, calendarId, syncToken: existingSyncToken, icsOpts: icsOptsFor(calendarId),
        state, calDir, syncDaysBack, syncDaysForward, windowStart, windowEnd, now, snapshot,
        acc: { created, updated, deleted, stranded, allNotes, failures, reconciledEventKeys },
      });
      switch (outcome.kind) {
        case "synced":
          if (outcome.fullResync) isFullResync = true;
          break;
        case "failed":
          failures.push(outcome.failure);
          break;
        default:
          assertNever(outcome);
      }
    }

    // Process locally-marked deletes (X-CB-DELETE property)
    const deleteResult = await processLocalDeletes({ boxRoot: this.boxRoot, calendar, state, calDir });
    deleted.push(...deleteResult.deleted);
    allNotes.push(...deleteResult.notes);
    failures.push(...deleteResult.failures);

    // Push local edits the pull never reached: a tracked file whose content no
    // longer matches the hash we recorded. Runs AFTER processLocalDeletes so a
    // file marked X-CB-DELETE is gone (or still marked, and skipped) rather
    // than patched.
    const pendingResult = await pushPendingLocalEdits({
      boxRoot: this.boxRoot, calendar, state, calDir, reconciledEventKeys, icsOptsFor, now,
    });
    updated.push(...pendingResult.updated);
    allNotes.push(...pendingResult.notes);
    failures.push(...pendingResult.failures);
    stranded.push(...pendingResult.stranded);

    // Push locally-created files to Google, clean unparseable orphans
    const defaultCalendarId = calendars[0] || "primary";
    const orphanResult = await pushAndCleanOrphans(
      { boxRoot: this.boxRoot, calendar, state, calDir, defaultCalendarId },
    );
    const pushed = orphanResult.pushed;
    deleted.push(...orphanResult.deleted);
    allNotes.push(...orphanResult.notes);
    failures.push(...orphanResult.failures);

    await this.saveState(state, snapshot);

    // Commit an EXPLICIT changed-file list — never a bare directory-staged
    // commit that could sweep a concurrent mutator's staged files. The list
    // mirrors the other connectors: the per-event files this sync
    // created/updated/deleted/pushed (each already box-root-relative from the
    // sync/push modules) plus the two connector-owned config files the sync
    // rewrites every run — the committed calendar state (eventFiles) and the
    // cached calendar metadata (names/roles). stageAndCommitPaths' fast path
    // no-ops when none of these actually changed, replacing the old
    // getStatus-guarded second commit for a token-only refresh.
    const changedEventFiles = [...created, ...updated, ...deleted, ...pushed, ...stranded];
    const paths = [
      ...changedEventFiles,
      path.relative(this.boxRoot, this.statePath()),
      "config/connectors/google-calendar.json",
    ];
    const message = changedEventFiles.length > 0 || failures.length > 0
      ? buildNarrativeCommitMessage(allNotes, {
        isFullResync,
        totalEvents: changedEventFiles.length,
        failures,
      })
      : "Sync calendar: no changes (token refreshed)";
    await stageAndCommitPaths(this.boxRoot, {
      paths,
      message,
      trailers: { "Pulled-By": "google-calendar-connector", ...(this.triggeredBy ? { "Triggered-By": this.triggeredBy } : {}) },
    });

    const result: SyncResult = { success: failures.length === 0, created, updated };
    if (pushed.length > 0) result.pushed = pushed;
    if (failures.length > 0) {
      result.error = `Calendar sync failed for ${failures.map(formatCalendarSyncFailure).join(", ")}`;
    }
    return result;
  }

}

export function createGoogleCalendarConnector(
  boxRoot: string,
  options?: GoogleCalendarConnectorOptions,
): Connector {
  const connector = new GoogleCalendarConnector(boxRoot, options);
  registerConnector(connector);
  return connector;
}
