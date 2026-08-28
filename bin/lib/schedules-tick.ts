/**
 * The tick: one launchd firing, and the alert an unrunnable schedule raises.
 *
 * Split out of `schedules-runner.ts` (which owns due-ness and the single-run
 * path) as a pure move — the tick is the whole-store pass, the runner is one
 * schedule at a time.
 *
 * Design: callback-box/docs/plans/scheduled-workstreams.md (Track B).
 */

import { loadSchedules, runIdFor, type InvalidSchedule, type ScheduleEntry } from "./schedules.js";
import {
  acquireLock,
  ensureStoreRoot,
  lockStaleAfterMs,
  readAlerts,
  readScheduleState,
  releaseLock,
  updateStoreState,
} from "./schedules-store.js";
import { raiseAlert, type RunnerDeps } from "./schedules-alerts.js";
import { isDue, runSchedule, type RunReport } from "./schedules-runner.js";

export interface TickResult {
  exitCode: number;
  reports: RunReport[];
  invalid: ScheduleEntry[];
  heartbeatError: string | null;
}

/** The title every "this schedule cannot run" alert carries. It is also the
 *  latch: a tick raises one only when no OPEN alert with this title exists for
 *  the schedule, so a schedule left broken for a month is one record rather
 *  than one every fifteen minutes — and acknowledging it re-arms the alarm for
 *  a break that is still not fixed. */
export const INVALID_SCHEDULE_ALERT_TITLE = "schedule cannot run";

/** An invalid schedule is silent otherwise: it never runs, so no run can fail
 *  and no run can report. The alert IS the notice. */
async function alertInvalidSchedule(deps: RunnerDeps, entry: InvalidSchedule): Promise<void> {
  // A latch that cannot be read is not a reason to stay quiet, and not a reason
  // to abandon the rest of the tick: an unreadable alert record means raise the
  // alert anyway. A duplicate record is a nuisance; a swallowed one is the
  // failure this whole design exists to prevent.
  let latched = false;
  try {
    const alerts = await readAlerts(deps.storeRoot, entry.name);
    latched = alerts.some((alert) => alert.state === "open" && alert.title === INVALID_SCHEDULE_ALERT_TITLE);
  } catch (e) {
    process.stderr.write(`schedules: cannot read ${entry.name}'s alerts (${e instanceof Error ? e.message : String(e)}); alerting anyway\n`);
  }
  if (latched) return;
  const problems = entry.issues.map((issue) => `- \`${issue.path}\`: ${issue.message}`).join("\n");
  await raiseAlert(deps, {
    workstream: entry.name,
    runId: null,
    title: INVALID_SCHEDULE_ALERT_TITLE,
    message: `${entry.name} is skipped every tick: ${entry.issues.length === 1 ? "1 problem" : `${String(entry.issues.length)} problems`} in schedules/${entry.name}/. Fix it and run \`bin/schedules lint\`.`,
    details: problems,
    priority: "important",
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
    await deps.notify({ title: "callback-box schedules", message: `cannot write the schedule store: ${message}` });
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
      await deps.notify({ title: "callback-box schedules", message: `cannot write the schedule store: ${message}` });
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
    await deps.notify({ title: "callback-box schedules", message: `cannot write the schedule store: ${message}` });
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
