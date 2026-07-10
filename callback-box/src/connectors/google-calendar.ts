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
import { HTTPError } from "ky";
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
  type SyncNote,
} from "./google-calendar-notes.js";
import {
  calendarStatePath,
  calendarDir,
  loadCalendarState,
  saveCalendarState,
  type CalendarState,
  type SyncTokenSnapshot,
} from "./google-calendar-state.js";
import { syncCalendar } from "./google-calendar-sync.js";
import { pushAndCleanOrphans, processLocalDeletes } from "./google-calendar-push.js";

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
    return createGoogleCalendarService(createGoogleAuthService(auth));
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
    const state = await this.loadState();
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
    const allNotes: SyncNote[] = [];
    let isFullResync = false;

    for (const calendarId of calendars) {
      const existingSyncToken = state.syncTokens[calendarId];
      const icsOpts: { calendarId: string; calendarName?: string; calendarRole?: string } = { calendarId };
      if (calendarNames[calendarId]) icsOpts.calendarName = calendarNames[calendarId];
      if (calendarRoles[calendarId]) icsOpts.calendarRole = calendarRoles[calendarId];

      const outcome = await this.runCalendarSync({
        calendar, calendarId, syncToken: existingSyncToken, icsOpts, state, calDir,
        syncDaysBack, syncDaysForward, windowStart, windowEnd, snapshot,
        acc: { created, updated, deleted, allNotes },
      });
      if (outcome.fullResync) isFullResync = true;
      if (outcome.error) {
        return { success: false, created, updated, error: outcome.error };
      }
    }

    // Process locally-marked deletes (X-CB-DELETE property)
    const deleteResult = await processLocalDeletes({ boxRoot: this.boxRoot, calendar, state, calDir });
    deleted.push(...deleteResult.deleted);
    allNotes.push(...deleteResult.notes);

    // Push locally-created files to Google, clean unparseable orphans
    const defaultCalendarId = calendars[0] || "primary";
    const orphanResult = await pushAndCleanOrphans(
      { boxRoot: this.boxRoot, calendar, state, calDir, defaultCalendarId },
    );
    const pushed = orphanResult.pushed;
    deleted.push(...orphanResult.deleted);
    allNotes.push(...orphanResult.notes);

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
    const changedEventFiles = [...created, ...updated, ...deleted, ...pushed];
    const paths = [
      ...changedEventFiles,
      path.relative(this.boxRoot, this.statePath()),
      "config/connectors/google-calendar.json",
    ];
    const message =
      changedEventFiles.length > 0
        ? buildNarrativeCommitMessage(allNotes, { isFullResync, totalEvents: changedEventFiles.length })
        : "Sync calendar: no changes (token refreshed)";
    await stageAndCommitPaths(this.boxRoot, {
      paths,
      message,
      trailers: { "Pulled-By": "google-calendar-connector", ...(this.triggeredBy ? { "Triggered-By": this.triggeredBy } : {}) },
    });

    const result: SyncResult = { success: true, created, updated };
    if (pushed.length > 0) result.pushed = pushed;
    return result;
  }

  /**
   * Sync one calendar, retrying with a full sync if the sync token expired (410).
   * Accumulates results into `acc`; returns whether a full resync happened and
   * any fatal error message. State is persisted on the error/410 paths.
   */
  private async runCalendarSync(opts: {
    calendar: GoogleCalendarService;
    calendarId: string;
    syncToken: string | undefined;
    icsOpts: { calendarId: string; calendarName?: string; calendarRole?: string };
    state: CalendarState;
    calDir: string;
    syncDaysBack: number;
    syncDaysForward: number;
    windowStart: Date;
    windowEnd: Date;
    snapshot: SyncTokenSnapshot;
    acc: { created: string[]; updated: string[]; deleted: string[]; allNotes: SyncNote[] };
  }): Promise<{ fullResync: boolean; error?: string }> {
    const { calendar, calendarId, syncToken, icsOpts, state, calDir,
            syncDaysBack, syncDaysForward, windowStart, windowEnd, snapshot, acc } = opts;
    const base = {
      boxRoot: this.boxRoot, calendar, calendarId, syncDaysBack, syncDaysForward,
      state, icsOpts, calDir, windowStart, windowEnd,
    };
    const collect = (r: { created: string[]; updated: string[]; deleted: string[]; notes: SyncNote[] }, opts2: { withNotes: boolean }): void => {
      acc.created.push(...r.created);
      acc.updated.push(...r.updated);
      acc.deleted.push(...r.deleted);
      if (opts2.withNotes) acc.allNotes.push(...r.notes);
    };

    try {
      collect(await syncCalendar({ ...base, syncToken }), { withNotes: true });
      return { fullResync: false };
    } catch (err) {
      const status = err instanceof HTTPError ? err.response.status : undefined;
      const message = (err as Error).message;
      if (status !== 410 && !message.includes("410")) {
        await this.saveState(state, snapshot);
        return { fullResync: false, error: `Calendar sync failed for ${calendarId}: ${message}` };
      }
      console.log(`  Sync token expired for ${calendarId}, doing full sync...`);
      delete state.syncTokens[calendarId];
      await this.saveState(state, snapshot);
      // Don't add individual notes for full re-sync — the message will summarize
      collect(await syncCalendar({ ...base, syncToken: undefined }), { withNotes: false });
      return { fullResync: true };
    }
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
