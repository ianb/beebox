/**
 * The runner: due-ness, the lock, one execution of a schedule's `run` script,
 * and the tick that drives them.
 *
 * launchd's own missed-run semantics are undocumented and lossy (a
 * `StartInterval` firing during sleep is simply missed), so due-ness is
 * computed here from persisted state — the anacron model — and launchd only
 * supplies a 15-minute heartbeat. That heartbeat is stamped BEFORE any
 * schedule runs, because "nothing ran at all" is the failure that actually
 * happened twice and no job can report its own death.
 *
 * Design: callback-box/docs/plans/scheduled-workstreams.md (Track B).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  loadSchedules,
  runIdFor,
  type Handoff,
  type LoadedSchedule,
  type Outcome,
  type ScheduleConfig,
  type ScheduleEntry,
  type ScheduleState,
} from "./schedules.js";
import {
  acquireLock,
  ensureScheduleDir,
  ensureStoreRoot,
  logPath,
  readHandoff,
  readRunExit,
  readScheduleState,
  releaseLock,
  tailLog,
  writeRunExit,
  writeScheduleState,
  writeStoreState,
} from "./schedules-store.js";
import { raiseAlert, type RunnerDeps } from "./schedules-alerts.js";
import { execChild, scheduleEnv } from "./schedules-exec.js";
import { alertIfBailed, startWorkstream } from "./schedules-workstream.js";

/** How many log lines a `failed` alert carries as details. */
const LOG_TAIL_LINES = 40;
/** Printed by `bin/schedules handoff` under `SCHEDULE_DRY_RUN=1` instead of
 *  writing a record, so a dry run can still report the would-be outcome. */
export const DRY_RUN_HANDOFF_MARKER = "[schedules] would hand off:";

// ─── Due-ness (pure) ──────────────────────────────────────────────────────

export function isDue(input: { config: ScheduleConfig; state: ScheduleState }, nowMs: number): boolean {
  if (!input.config.enabled) return false;
  if (input.state.lastRunAt === null) return true;
  return nowMs - Date.parse(input.state.lastRunAt) >= input.config.cadenceMs;
}

/** When the next run becomes due; null for a schedule that never ran (it is
 *  due now) or one that is disabled. */
export function nextDueAtMs(input: { config: ScheduleConfig; state: ScheduleState }): number | null {
  if (!input.config.enabled || input.state.lastRunAt === null) return null;
  return Date.parse(input.state.lastRunAt) + input.config.cadenceMs;
}

/**
 * Overdue is derived, never stored: the cadence plus its grace has elapsed and
 * nothing ran. A schedule that has never run is *due*, not overdue — there is
 * no elapsed interval to measure, and calling a freshly-enrolled schedule
 * overdue would cry wolf on the day it is written.
 */
export function isOverdue(input: { config: ScheduleConfig; state: ScheduleState }, nowMs: number): boolean {
  if (!input.config.enabled || input.state.lastRunAt === null) return false;
  return nowMs - Date.parse(input.state.lastRunAt) > input.config.cadenceMs + input.config.graceMs;
}

/**
 * A non-zero exit is `failed` even when the script managed to write a handoff
 * first — the handoff is then a partial answer from a run that broke, and the
 * briefing carries both.
 */
export function classifyOutcome(input: { exitCode: number | null; hasHandoff: boolean }): Outcome {
  if (input.exitCode !== 0) return "failed";
  return input.hasHandoff ? "handoff" : "clean";
}

export type RunReport =
  | { kind: "skipped"; name: string; reason: string }
  | { kind: "dry-run"; name: string; runId: string; outcome: Outcome; exitCode: number | null; timedOut: boolean; output: string }
  | { kind: "ran"; name: string; runId: string; outcome: Outcome; exitCode: number | null; timedOut: boolean; handoff: Handoff | null; alertId: string | null };

/**
 * A lock whose owner PID is dead is debris from a crash or a laptop shutdown,
 * and the run it belonged to never got to finish its story. If that run had
 * started a session, the absent-result rule applies to it exactly as it would
 * have at the end of a live session — otherwise a mid-session shutdown is the
 * one way a bailed run stays silent.
 */
async function accountForReclaimedRun(deps: RunnerDeps, reclaimed: { name: string; runId: string }): Promise<void> {
  const exit = await readRunExit(deps.storeRoot, reclaimed);
  if (exit === null || !exit.sessionLaunched) return;
  await alertIfBailed(deps, { ...reclaimed, logFile: logPath(deps.storeRoot, reclaimed) });
}

/**
 * One execution of one schedule: lock, run, classify, record, and — when the
 * schedule declares a workstream and the run has something to say — the agent
 * session, in the foreground, before this returns.
 *
 * `--dry-run` writes NOTHING — no lock, no log, no state — so it is safe on a
 * schedule whose real run is in flight, and so a `run` script's own dry-run
 * handling is what is being exercised. It never starts a session either: a dry
 * run is a rehearsal of the head, not of the agent.
 */
export async function runSchedule(
  deps: RunnerDeps,
  request: { schedule: LoadedSchedule; dryRun: boolean },
): Promise<RunReport> {
  const { schedule } = request;
  const at = deps.now();
  const runId = runIdFor(at);
  const script = path.join(schedule.dir, "run");
  const stateDir = path.join(deps.storeRoot, schedule.name);

  if (request.dryRun) {
    const result = await execChild({ file: script, args: [] }, {
      cwd: deps.repoRoot,
      env: scheduleEnv({ name: schedule.name, dir: schedule.dir, runId, stateDir, dryRun: true }),
      timeoutMs: schedule.config.timeoutMs,
      logFile: null,
      input: null,
    });
    const hasHandoff = result.output.includes(DRY_RUN_HANDOFF_MARKER);
    return {
      kind: "dry-run",
      name: schedule.name,
      runId,
      outcome: classifyOutcome({ exitCode: result.exitCode, hasHandoff }),
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      output: result.output,
    };
  }

  // Marker first, then the schedule's own directory: a run reached directly
  // (a test, a future caller) must leave the store in the same shape the CLI's
  // entry points do, or the session's own `bin/schedules done` refuses it.
  await ensureStoreRoot(deps.storeRoot);
  await ensureScheduleDir(deps.storeRoot, schedule.name);
  const previous = await readScheduleState(deps.storeRoot, schedule.name);
  const lock = await acquireLock(deps.storeRoot, {
    name: schedule.name,
    runId,
    pid: deps.pid,
    isProcessAlive: deps.isProcessAlive,
    at,
  });
  if (lock.kind === "held") {
    // Not an alert: the NEXT tick's overdue derivation is the signal if this
    // keeps happening, and a lock held by a live run is normal.
    return { kind: "skipped", name: schedule.name, reason: `lock held by pid ${String(lock.pid ?? 0)}` };
  }
  if (lock.reclaimed !== null) {
    await accountForReclaimedRun(deps, { name: schedule.name, runId: lock.reclaimed.runId });
  }

  try {
    const logFile = logPath(deps.storeRoot, { name: schedule.name, runId });
    const env = scheduleEnv({ name: schedule.name, dir: schedule.dir, runId, stateDir, dryRun: false });
    const result = await execChild({ file: script, args: [] }, {
      cwd: deps.repoRoot,
      env,
      timeoutMs: schedule.config.timeoutMs,
      logFile,
      input: null,
    });
    const handoff = await readHandoff(deps.storeRoot, { name: schedule.name, runId });
    const outcome = classifyOutcome({ exitCode: result.exitCode, hasHandoff: handoff !== null });
    const willLaunch = schedule.config.workstream !== null && (outcome === "handoff" || outcome === "failed");

    // Written BEFORE the session, with `sessionLaunched` already true: a runner
    // the laptop kills mid-session leaves this behind, and it is what tells the
    // next tick that the reclaimed run owed a report.
    const writeExit = async (session: { sessionExit: number | null; checkExit: number | null; timedOut: boolean }): Promise<void> => {
      await writeRunExit(deps.storeRoot, {
        name: schedule.name,
        runId,
        runExit: result.exitCode,
        sessionExit: session.sessionExit,
        checkExit: session.checkExit,
        sessionLaunched: willLaunch,
        timedOut: result.timedOut || session.timedOut,
        at: deps.now().toISOString(),
      });
    };
    await writeExit({ sessionExit: null, checkExit: null, timedOut: false });
    await writeScheduleState(deps.storeRoot, {
      name: schedule.name,
      state: {
        ...(await readScheduleState(deps.storeRoot, schedule.name)),
        lastRunAt: at.toISOString(),
        lastRunId: runId,
        lastExit: result.exitCode,
        lastOutcome: outcome,
      },
    });

    let alertId: string | null = null;
    if (outcome === "failed") {
      const tail = await tailLog(logFile, LOG_TAIL_LINES);
      const alert = await raiseAlert(deps, {
        workstream: schedule.name,
        runId,
        title: result.timedOut ? "run timed out" : "run failed",
        message: result.timedOut
          ? `${schedule.name} exceeded its timeout and was killed.`
          : `${schedule.name} exited ${String(result.exitCode)}.`,
        details: tail === "" ? null : `Last ${String(LOG_TAIL_LINES)} log lines:\n\n\`\`\`\n${tail}\n\`\`\``,
        priority: "important",
      });
      alertId = alert.id;
    }
    if (willLaunch) {
      const session = await startWorkstream(deps, { schedule, runId, outcome, handoff, previous });
      await writeExit(session);
    }
    return { kind: "ran", name: schedule.name, runId, outcome, exitCode: result.exitCode, timedOut: result.timedOut, handoff, alertId };
  } finally {
    await releaseLock(deps.storeRoot, schedule.name);
  }
}

// ─── The tick ─────────────────────────────────────────────────────────────

export interface TickResult {
  exitCode: number;
  reports: RunReport[];
  invalid: ScheduleEntry[];
  heartbeatError: string | null;
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
  try {
    await ensureStoreRoot(deps.storeRoot);
    await writeStoreState(deps.storeRoot, { lastTickAt: startedAt.toISOString(), lastTickExit: null });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await deps.notify({ title: "callback-box schedules", message: `cannot write the schedule store: ${message}` });
    return { exitCode: 1, reports: [], invalid: [], heartbeatError: message };
  }

  const lock = await acquireLock(deps.storeRoot, {
    name: TICK_LOCK_NAME,
    runId: runIdFor(startedAt),
    pid: deps.pid,
    isProcessAlive: deps.isProcessAlive,
    at: startedAt,
  });
  if (lock.kind === "held") {
    return { exitCode: 0, reports: [{ kind: "skipped", name: "tick", reason: `tick already running (pid ${String(lock.pid ?? 0)})` }], invalid: [], heartbeatError: null };
  }

  const reports: RunReport[] = [];
  const invalid: ScheduleEntry[] = [];
  try {
    const entries = await loadSchedules(deps.schedulesRoot);
    for (const entry of entries) {
      if (entry.kind === "invalid") {
        // Track E turns this into an `important` alert; until then it is a
        // loud line in the tick's launchd log rather than a silent skip.
        invalid.push(entry);
        process.stderr.write(`schedules: ${entry.name} is invalid — ${entry.issues.map((i) => `${i.path} ${i.message}`).join("; ")}\n`);
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
  await writeStoreState(deps.storeRoot, { lastTickAt: startedAt.toISOString(), lastTickExit: 0 });
  return { exitCode: 0, reports, invalid, heartbeatError: null };
}

/** Where a schedule's own state directory is, for callers that hand it to a
 *  child process (`SCHEDULE_STATE_DIR`) without going through the runner. */
export function scheduleStateDir(storeRoot: string, name: string): string {
  return path.join(storeRoot, name);
}

/** Used by `logs`: the run log's contents, or null when there is none. */
export async function readRunLog(storeRoot: string, run: { name: string; runId: string }): Promise<string | null> {
  try {
    return await fs.readFile(logPath(storeRoot, run), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
