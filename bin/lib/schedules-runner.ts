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

import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

import {
  alertIdFor,
  loadSchedules,
  runIdFor,
  type Alert,
  type Handoff,
  type LoadedSchedule,
  type Outcome,
  type Priority,
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
  readScheduleState,
  releaseLock,
  tailLog,
  writeAlert,
  writeRunExit,
  writeScheduleState,
  writeStoreState,
} from "./schedules-store.js";

/** Everything the runner touches that a test wants to hold still. */
export interface RunnerDeps {
  /** `<parent>/schedule-runs` (or `CALLBACK_SCHEDULES_ROOT`). */
  storeRoot: string;
  /** `<checkout>/schedules`. */
  schedulesRoot: string;
  /** The checkout `run` scripts execute in. */
  repoRoot: string;
  now: () => Date;
  pid: number;
  isProcessAlive: (pid: number) => boolean;
  notify: (notification: { title: string; message: string }) => Promise<void>;
}

/** How many log lines a `failed` alert carries as details. */
const LOG_TAIL_LINES = 40;
/** Grace between SIGTERM and SIGKILL for a run that overran its timeout. */
const KILL_GRACE_MS = 5000;

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

// ─── Alerts ───────────────────────────────────────────────────────────────

export interface AlertInput {
  workstream: string;
  runId: string | null;
  title: string;
  message: string;
  details: string | null;
  priority: Priority;
}

/**
 * Write the record, then deliver. The record is the truth; the macOS
 * notification is one best-effort delivery of it, and a machine without
 * `osascript` (or with notifications off) still gets the alert.
 */
export async function raiseAlert(deps: RunnerDeps, input: AlertInput): Promise<Alert> {
  const at = deps.now();
  const alert: Alert = {
    id: alertIdFor(at, randomBytes(2).toString("hex")),
    workstream: input.workstream,
    runId: input.runId,
    title: input.title,
    message: input.message,
    details: input.details,
    priority: input.priority,
    createdAt: at.toISOString(),
    state: "open",
    acknowledgedAt: null,
  };
  await ensureScheduleDir(deps.storeRoot, input.workstream);
  await writeAlert(deps.storeRoot, alert);
  await deps.notify({ title: `${input.workstream}: ${input.title}`, message: input.message });
  return alert;
}

/** Best-effort macOS notification. Absent `osascript` is not an error — the
 *  record was already written by the time this runs. */
export async function osascriptNotify(notification: { title: string; message: string }): Promise<void> {
  await new Promise<void>((resolve) => {
    const quote = (text: string): string => text.replace(/["\\]/g, " ").replace(/\n/g, " ");
    const child = spawn(
      "/usr/bin/osascript",
      ["-e", `display notification "${quote(notification.message)}" with title "${quote(notification.title)}"`],
      { stdio: "ignore" },
    );
    child.on("error", () => { resolve(); });
    child.on("exit", () => { resolve(); });
  });
}

// ─── Executing one `run` script ───────────────────────────────────────────

interface ExecOutcome {
  exitCode: number | null;
  timedOut: boolean;
  output: string;
}

/**
 * Run the script with the schedule's environment, streaming to the run log (a
 * real run) or capturing for stdout (a dry run). A run that overruns its
 * timeout is killed and reads as a failure — a hung job is silence, which is
 * the thing this plan refuses to allow.
 */
async function execRun(
  script: string,
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; logFile: string | null },
): Promise<ExecOutcome> {
  const stream = options.logFile === null ? null : fsSync.createWriteStream(options.logFile, { flags: "a" });
  const chunks: string[] = [];
  const child = spawn(script, [], { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] });

  const collect = (data: Buffer): void => {
    const text = data.toString("utf8");
    chunks.push(text);
    stream?.write(text);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS).unref();
  }, options.timeoutMs);

  const exitCode = await new Promise<number | null>((resolve) => {
    // A script that cannot be spawned at all (mode bit cleared between lint and
    // run) is a failed run, not a crashed runner.
    child.on("error", (e) => { chunks.push(`[schedules] could not execute ${script}: ${e.message}\n`); resolve(null); });
    child.on("close", (code) => { resolve(code); });
  });
  clearTimeout(timer);
  await new Promise<void>((resolve) => {
    if (stream === null) { resolve(); return; }
    stream.end(() => { resolve(); });
  });
  return { exitCode: timedOut ? null : exitCode, timedOut, output: chunks.join("") };
}

function runEnv(input: { name: string; dir: string; runId: string; stateDir: string; dryRun: boolean }): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SCHEDULE_NAME: input.name,
    SCHEDULE_DIR: input.dir,
    SCHEDULE_RUN_ID: input.runId,
    SCHEDULE_STATE_DIR: input.stateDir,
  };
  if (input.dryRun) env["SCHEDULE_DRY_RUN"] = "1";
  else delete env["SCHEDULE_DRY_RUN"];
  return env;
}

export type RunReport =
  | { kind: "skipped"; name: string; reason: string }
  | { kind: "dry-run"; name: string; runId: string; outcome: Outcome; exitCode: number | null; timedOut: boolean; output: string }
  | { kind: "ran"; name: string; runId: string; outcome: Outcome; exitCode: number | null; timedOut: boolean; handoff: Handoff | null; alertId: string | null };

/**
 * Workstream start (chunk 5 of the plan, Track B chunk 2). A `handoff` or a
 * failure on a schedule that declares a `workstream:` is supposed to launch a
 * headless agent session through `bin/lib/launch-session.sh` and the registry's
 * launch lease. Until that lands, the outcome and the records are written and
 * this says so out loud rather than silently doing nothing.
 */
async function startWorkstream(input: { name: string; runId: string; outcome: Outcome }): Promise<void> {
  process.stderr.write(
    `schedules: workstream start not implemented (chunk 5) — ${input.name} run ${input.runId} ended '${input.outcome}'\n`,
  );
  await Promise.resolve();
}

/**
 * One execution of one schedule: lock, run, classify, record.
 *
 * `--dry-run` writes NOTHING — no lock, no log, no state — so it is safe on a
 * schedule whose real run is in flight, and so a `run` script's own dry-run
 * handling is what is being exercised.
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
    const result = await execRun(script, {
      cwd: deps.repoRoot,
      env: runEnv({ name: schedule.name, dir: schedule.dir, runId, stateDir, dryRun: true }),
      timeoutMs: schedule.config.timeoutMs,
      logFile: null,
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

  await ensureScheduleDir(deps.storeRoot, schedule.name);
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

  try {
    const logFile = logPath(deps.storeRoot, { name: schedule.name, runId });
    const result = await execRun(script, {
      cwd: deps.repoRoot,
      env: runEnv({ name: schedule.name, dir: schedule.dir, runId, stateDir, dryRun: false }),
      timeoutMs: schedule.config.timeoutMs,
      logFile,
    });
    const handoff = await readHandoff(deps.storeRoot, { name: schedule.name, runId });
    const outcome = classifyOutcome({ exitCode: result.exitCode, hasHandoff: handoff !== null });

    await writeRunExit(deps.storeRoot, {
      name: schedule.name,
      runId,
      runExit: result.exitCode,
      sessionExit: null,
      checkExit: null,
      timedOut: result.timedOut,
      at: deps.now().toISOString(),
    });
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
    if (schedule.config.workstream !== null && (outcome === "handoff" || outcome === "failed")) {
      await startWorkstream({ name: schedule.name, runId, outcome });
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
