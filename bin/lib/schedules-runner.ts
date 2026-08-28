/**
 * The runner: due-ness, the lock, one execution of a schedule's `run` script,
 * and the tick that drives them.
 *
 * launchd's own missed-run semantics are undocumented and lossy (a
 * `StartInterval` firing during sleep is simply missed), so due-ness is
 * computed here from persisted state — the anacron model — and launchd only
 * supplies a 15-minute heartbeat. That heartbeat is stamped as soon as the tick
 * holds the tick lock and BEFORE any schedule runs, because "nothing ran at
 * all" is the failure that actually happened twice and no job can report its
 * own death. A tick that never got the lock records a SKIP instead: refreshing
 * the heartbeat there would report health it never established.
 *
 * Design: callback-box/docs/plans/scheduled-workstreams.md (Track B).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  runIdFor,
  type Handoff,
  type LoadedSchedule,
  type Outcome,
  type ScheduleConfig,
  type ScheduleState,
} from "./schedules.js";
import {
  acquireLock,
  ensureScheduleDir,
  ensureStoreRoot,
  lockStaleAfterMs,
  logPath,
  readHandoff,
  readRunExit,
  readScheduleState,
  releaseLock,
  tailLog,
  updateScheduleState,
  writeRunExit,
} from "./schedules-store.js";
import { raiseAlert, type RunnerDeps } from "./schedules-alerts.js";
import { execChild, scheduleEnv } from "./schedules-exec.js";
import { alertIfBailed, startWorkstream } from "./schedules-workstream.js";
import { errnoCode } from "../../callback-box/src/lib/error-guards.js";

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

/** What a failed run's alert says, in the three ways a run can fail. */
function failureText(
  name: string,
  result: { timedOut: boolean; logTruncated: boolean; exitCode: number | null },
): { title: string; message: string } {
  if (result.timedOut) return { title: "run timed out", message: `${name} exceeded its timeout and was killed.` };
  if (result.logTruncated) {
    return {
      title: "run output exceeded the log cap",
      message: `${name} wrote more output than the per-run log cap allows; the log was truncated and the run is recorded as failed.`,
    };
  }
  return { title: "run failed", message: `${name} exited ${String(result.exitCode)}.` };
}

/**
 * Why `bin/schedules run <name>` must refuse from here, or null when it may
 * proceed.
 *
 * A `worktree: false` schedule's session runs in the MAIN checkout, but its
 * `run` script executes in — and reads its evidence from — whichever checkout
 * the command was typed in. From a worktree those are two different trees, so
 * the agent would act on main from branch-local evidence (the SDK ledger, an
 * issue file, a lockfile that only exists on this branch). A dry run reads the
 * same evidence but starts nobody, so it stays allowed everywhere.
 */
export function refuseRunHere(input: {
  schedule: LoadedSchedule;
  repoRoot: string;
  mainRoot: string;
  dryRun: boolean;
}): string | null {
  if (input.dryRun) return null;
  const { workstream } = input.schedule.config;
  if (workstream === null || workstream.worktree) return null;
  if (input.repoRoot === input.mainRoot) return null;
  return [
    `${input.schedule.name} is a 'worktree: false' schedule: its session runs in the main checkout (${input.mainRoot}),`,
    `but this command would read its inputs from ${input.repoRoot}.`,
    "Run it from the main checkout, or use --dry-run here.",
  ].join("\n");
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
  if (exit === null) {
    // No exit record at all: the runner died between the `run` script and the
    // accounting. If that script had already written a handoff, the work it
    // found exists only in that file — nobody is coming back for it, and the
    // next run may find nothing new to report. The alert IS the handoff's
    // delivery. The session is deliberately NOT started here: a reclaim runs
    // inside another schedule's tick, and starting an agent from it would move
    // the launch out of the one place that accounts for it.
    const handoff = await readHandoff(deps.storeRoot, reclaimed);
    if (handoff === null) return;
    await raiseAlert(deps, {
      workstream: reclaimed.name,
      runId: reclaimed.runId,
      title: INTERRUPTED_HANDOFF_ALERT_TITLE,
      message: `${reclaimed.name} run ${reclaimed.runId} handed off "${handoff.title}" and was killed before it could start or record a session.`,
      details: handoff.body,
      priority: "important",
    });
    return;
  }
  if (!exit.sessionLaunched) return;
  await alertIfBailed(deps, { ...reclaimed, logFile: logPath(deps.storeRoot, reclaimed) });
}

/** The title a reclaimed run's orphaned handoff is filed under. */
export const INTERRUPTED_HANDOFF_ALERT_TITLE = "run interrupted after handoff";

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
    staleAfterMs: lockStaleAfterMs(schedule.config.timeoutMs),
    bootTimeMs: deps.bootTimeMs(),
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
    // A run that blew the log cap is failed whatever it exited: its output was
    // cut, so nothing downstream — the tail in an alert, the TRIAGE line a
    // `check` reads — can be trusted to be complete.
    const outcome = result.logTruncated
      ? "failed"
      : classifyOutcome({ exitCode: result.exitCode, hasHandoff: handoff !== null });
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
    await updateScheduleState(deps.storeRoot, {
      name: schedule.name,
      patch: {
        lastRunAt: at.toISOString(),
        lastRunId: runId,
        lastExit: result.exitCode,
        lastOutcome: outcome,
      },
    });

    let alertId: string | null = null;
    if (outcome === "failed") {
      const tail = await tailLog(logFile, LOG_TAIL_LINES);
      const failure = failureText(schedule.name, result);
      const alert = await raiseAlert(deps, {
        workstream: schedule.name,
        runId,
        title: failure.title,
        message: failure.message,
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



/** Used by `logs`: the run log's contents, or null when there is none. */
export async function readRunLog(storeRoot: string, run: { name: string; runId: string }): Promise<string | null> {
  try {
    return await fs.readFile(logPath(storeRoot, run), "utf8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
}
