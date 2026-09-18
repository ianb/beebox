/**
 * The tick: one launchd firing, and the alert an unrunnable schedule raises.
 *
 * Split out of `schedules-runner.ts` (which owns due-ness and the single-run
 * path) as a pure move — the tick is the whole-store pass, the runner is one
 * schedule at a time.
 *
 * Design: beebox/docs/plans/scheduled-workstreams.md (Track B).
 */

import { loadSchedules, runIdFor, type InvalidSchedule, type ScheduleEntry } from "./schedules.js";
import {
  acquireLock,
  ensureStoreRoot,
  lockStaleAfterMs,
  readScheduleState,
  releaseLock,
  updateStoreState,
} from "./schedules-store.js";
import { raiseAlert, type RunnerDeps } from "./schedules-alerts.js";
import { migrateAlerts, resolveConditions } from "./schedules-alert-lifecycle.js";
import { isDue, runSchedule, type RunReport } from "./schedules-runner.js";

export interface TickResult {
  exitCode: number;
  reports: RunReport[];
  invalid: ScheduleEntry[];
  heartbeatError: string | null;
}

/** The title every "this schedule cannot run" alert carries. */
export const INVALID_SCHEDULE_ALERT_TITLE = "schedule cannot run";

/** The condition it raises under: a schedule left broken for a month is one
 *  record with a count rather than one every fifteen minutes, and the tick
 *  resolves it once the schedule loads again. Acknowledging it re-arms the
 *  alarm for a break that is still not fixed. */
const INVALID_SCHEDULE_CONDITION = "invalid-schedule";

/** An invalid schedule is silent otherwise: it never runs, so no run can fail
 *  and no run can report. The alert IS the notice. */
async function alertInvalidSchedule(deps: RunnerDeps, entry: InvalidSchedule): Promise<void> {
  const problems = entry.issues.map((issue) => `- \`${issue.path}\`: ${issue.message}`).join("\n");
  await raiseAlert(deps, {
    workstream: entry.name,
    runId: null,
    title: INVALID_SCHEDULE_ALERT_TITLE,
    message: `${entry.name} is skipped every tick: ${entry.issues.length === 1 ? "1 problem" : `${String(entry.issues.length)} problems`} in schedules/${entry.name}/. Fix it and run \`bin/schedules lint\`.`,
    details: problems,
    priority: "important",
    condition: INVALID_SCHEDULE_CONDITION,
  });
}

/** The store root's own lock name — hidden, so it can never collide with a
 *  schedule directory. */
const TICK_LOCK_NAME = ".tick";

/**
 * One launchd firing. Stamps the heartbeat FIRST: a tick that cannot write the
 * store is the critical gap in the plan, so it exits non-zero (launchd's log)
 * and notifies rather than proceeding quietly.
 */
export async function tick(deps: RunnerDeps): Promise<TickResult> {
  const startedAt = deps.now();
  let entries: ScheduleEntry[];
  try {
    await ensureStoreRoot(deps.storeRoot);
    // Loaded before the lock, so the tick's own staleness window can be the
    // longest run it could legitimately be waiting on.
    entries = await loadSchedules(deps.schedulesRoot);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await notifyStoreFailure(deps, message);
    return { exitCode: 1, reports: [], invalid: [], heartbeatError: message };
  }

  const longestTimeoutMs = Math.max(
    0,
    ...entries.map((entry) => (entry.kind === "ok" ? entry.config.timeoutMs : 0)),
  );
  const lock = await acquireLock(deps.storeRoot, {
    name: TICK_LOCK_NAME,
    runId: runIdFor(startedAt),
    pid: deps.pid,
    isProcessAlive: deps.isProcessAlive,
    at: startedAt,
    staleAfterMs: lockStaleAfterMs(longestTimeoutMs),
    bootTimeMs: deps.bootTimeMs(),
  });
  if (lock.kind === "held") {
    // The heartbeat is NOT refreshed here. A tick that never got past the lock
    // has proved nothing about whether schedules can run, and a tick hung in a
    // child would otherwise keep `last tick just now` on screen forever while
    // nothing at all happened (the 2026-08-24 review's finding 3).
    const reason = `tick already running (pid ${String(lock.pid ?? 0)})`;
    try {
      await updateStoreState(deps.storeRoot, {
        lastTickSkippedAt: startedAt.toISOString(),
        lastTickSkippedReason: reason,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await notifyStoreFailure(deps, message);
      return { exitCode: 1, reports: [], invalid: [], heartbeatError: message };
    }
    return { exitCode: 0, reports: [{ kind: "skipped", name: "tick", reason }], invalid: [], heartbeatError: null };
  }

  // Stamped here rather than at entry: past the lock, this tick is the one that
  // will do the work, so the heartbeat now means what it says. Still BEFORE any
  // schedule runs, because a run that hangs must not take the heartbeat with it.
  try {
    await updateStoreState(deps.storeRoot, { lastTickAt: startedAt.toISOString(), lastTickExit: null });
  } catch (e) {
    await releaseLock(deps.storeRoot, TICK_LOCK_NAME);
    const message = e instanceof Error ? e.message : String(e);
    await notifyStoreFailure(deps, message);
    return { exitCode: 1, reports: [], invalid: [], heartbeatError: message };
  }

  // Records from before conditions are rewritten before anything reads them:
  // every reader below is strict on the new shape. Idempotent, so this is a
  // directory scan on every tick after the first.
  try {
    const migrated = await migrateAlerts(deps.storeRoot, startedAt.toISOString());
    if (migrated > 0) process.stdout.write(`schedules: migrated ${String(migrated)} alert record(s) to the condition shape\n`);
  } catch (e) {
    await releaseLock(deps.storeRoot, TICK_LOCK_NAME);
    const message = e instanceof Error ? e.message : String(e);
    await notifyStoreFailure(deps, `alert migration failed: ${message}`);
    return { exitCode: 1, reports: [], invalid: [], heartbeatError: message };
  }

  const reports: RunReport[] = [];
  const invalid: ScheduleEntry[] = [];
  try {
    for (const entry of entries) {
      if (entry.kind === "invalid") {
        invalid.push(entry);
        process.stderr.write(`schedules: ${entry.name} is invalid — ${entry.issues.map((i) => `${i.path} ${i.message}`).join("; ")}\n`);
        await alertInvalidSchedule(deps, entry);
        continue;
      }
      await resolveConditions(deps.storeRoot, {
        workstream: entry.name, conditions: [INVALID_SCHEDULE_CONDITION], except: [], at: deps.now().toISOString(),
      });
      const state = await readScheduleState(deps.storeRoot, entry.name);
      if (!isDue({ config: entry.config, state }, deps.now().getTime())) continue;
      reports.push(await runSchedule(deps, { schedule: entry, dryRun: false }));
    }
  } finally {
    await releaseLock(deps.storeRoot, TICK_LOCK_NAME);
  }

  // A failed RUN is already an `important` alert; the tick itself succeeded.
  // Reserving a non-zero tick exit for "the store could not be written" keeps
  // the launchd log meaningful.
  await updateStoreState(deps.storeRoot, { lastTickAt: startedAt.toISOString(), lastTickExit: 0 });
  return { exitCode: 0, reports, invalid, heartbeatError: null };
}

async function notifyStoreFailure(deps: RunnerDeps, message: string): Promise<void> {
  await deps.notify({
    title: "beebox schedules",
    message: `cannot write the schedule store: ${message}`,
    group: "schedule-store-failure",
    destination: "http://localhost:3210/workstreams/streams",
  });
}
