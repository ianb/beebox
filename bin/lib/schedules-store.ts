/**
 * The scheduled-run store: `<parent-of-main-checkout>/schedule-runs/`.
 *
 * Outside git, outside every worktree, one per machine — logs the boxholder
 * asked to keep out of the checkout, plus the state due-ness is computed from
 * and the alert records that are the message channel. The marker-file
 * discipline is `bin/lib/exhibits-store.sh`'s: a same-named unrelated
 * directory is refused, never adopted.
 *
 * Every write is temp-plus-rename, because the file that says when a schedule
 * last ran is exactly the file a crash mid-write would make unreadable.
 *
 * Design: callback-box/docs/plans/scheduled-workstreams.md (Track B).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import {
  EMPTY_SCHEDULE_STATE,
  SCHEDULES_MARKER,
  ScheduleError,
  alertSchema,
  handoffSchema,
  resultSchema,
  runExitSchema,
  scheduleStateSchema,
  storeStateSchema,
  type Alert,
  type Handoff,
  type Result,
  type RunExit,
  type ScheduleState,
  type StoreState,
} from "./schedules.js";

/** Refused rather than adopted: an unmarked directory where the store should
 *  be is somebody else's data. */
export async function ensureStoreRoot(root: string): Promise<void> {
  const marker = path.join(root, SCHEDULES_MARKER);
  try {
    await fs.stat(root);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(marker, "", "utf8");
    return;
  }
  try {
    await fs.stat(marker);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    // An empty directory holds nobody's data — typically a prior tick that
    // made the directory and died before its marker (seen 2026-08-25).
    if ((await fs.readdir(root)).length === 0) {
      await fs.writeFile(marker, "", "utf8");
      return;
    }
    throw new ScheduleError(`${root} exists without ${SCHEDULES_MARKER} — refusing to adopt an unrelated directory`);
  }
}

function scheduleDir(root: string, name: string): string {
  return path.join(root, name);
}

export async function ensureScheduleDir(root: string, name: string): Promise<string> {
  const dir = scheduleDir(root, name);
  await fs.mkdir(path.join(dir, "runs"), { recursive: true });
  await fs.mkdir(path.join(dir, "alerts"), { recursive: true });
  return dir;
}

/** Temp sibling, then rename: a reader sees the old file or the new one. */
async function writeAtomic(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${randomBytes(6).toString("hex")}.tmp`;
  await fs.writeFile(temp, content, "utf8");
  await fs.rename(temp, filePath);
}

async function readJson<T>(filePath: string, schema: z.ZodType<T>): Promise<T | null> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  const parsed = schema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new ScheduleError(`${filePath} is not a valid record: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  }
  return parsed.data;
}

async function writeJson<T>(filePath: string, record: T): Promise<void> {
  await writeAtomic(filePath, `${JSON.stringify(record, null, 2)}\n`);
}

// ─── Heartbeat (store root) ───────────────────────────────────────────────

function storeStatePath(root: string): string {
  return path.join(root, "state.json");
}

export async function readStoreState(root: string): Promise<StoreState | null> {
  return readJson(storeStatePath(root), storeStateSchema);
}

async function writeStoreState(root: string, state: StoreState): Promise<void> {
  await writeJson(storeStatePath(root), state);
}

/**
 * Read-modify-write of the heartbeat record: a caller that only has something
 * to say about the SKIP fields must not blank the last real tick, and vice
 * versa. Returns false when there is no record yet and the patch cannot make a
 * whole one (no `lastTickAt`) — a skipped tick with no history to preserve.
 */
export async function updateStoreState(root: string, patch: Partial<StoreState>): Promise<boolean> {
  const current = await readStoreState(root);
  const lastTickAt = patch.lastTickAt ?? current?.lastTickAt;
  if (lastTickAt === undefined) return false;
  await writeStoreState(root, {
    lastTickAt,
    lastTickExit: patch.lastTickExit === undefined ? current?.lastTickExit ?? null : patch.lastTickExit,
    lastTickSkippedAt: patch.lastTickSkippedAt === undefined ? current?.lastTickSkippedAt ?? null : patch.lastTickSkippedAt,
    lastTickSkippedReason: patch.lastTickSkippedReason === undefined ? current?.lastTickSkippedReason ?? null : patch.lastTickSkippedReason,
  });
  return true;
}

// ─── Per-schedule state ───────────────────────────────────────────────────

export async function readScheduleState(root: string, name: string): Promise<ScheduleState> {
  const state = await readJson(path.join(scheduleDir(root, name), "state.json"), scheduleStateSchema);
  return state === null ? EMPTY_SCHEDULE_STATE : state;
}

async function writeScheduleState(root: string, update: { name: string; state: ScheduleState }): Promise<void> {
  await writeJson(path.join(scheduleDir(root, update.name), "state.json"), update.state);
}

/**
 * The ONLY way a live run should write state: read-modify-write of the record
 * on disk, never of a snapshot taken earlier. Two things in one run update this
 * file — the run's own outcome and the persistent session id minted while the
 * session starts — and a write built from a stale snapshot silently reverts the
 * other one (the 2026-08-24 review's first critical: a first persistent run
 * nulled its own `lastRunAt` and stayed due every tick).
 *
 * Callers hold the schedule's lock, so the read and the write are one
 * transaction with respect to every other runner.
 */
export async function updateScheduleState(root: string, update: { name: string; patch: Partial<ScheduleState> }): Promise<ScheduleState> {
  const current = await readScheduleState(root, update.name);
  const merged: ScheduleState = { ...current, ...update.patch };
  await writeScheduleState(root, { name: update.name, state: merged });
  return merged;
}

// ─── Per-run records ──────────────────────────────────────────────────────

function runFilePath(dir: string, file: string): string {
  return path.join(dir, "runs", file);
}

export async function readHandoff(root: string, run: { name: string; runId: string }): Promise<Handoff | null> {
  return readJson(runFilePath(scheduleDir(root, run.name), `${run.runId}.handoff.json`), handoffSchema);
}

export async function writeHandoff(root: string, record: Handoff & { name: string }): Promise<void> {
  const { name, ...handoff } = record;
  await writeJson(runFilePath(scheduleDir(root, name), `${handoff.runId}.handoff.json`), handoff);
}

export async function readResult(root: string, run: { name: string; runId: string }): Promise<Result | null> {
  return readJson(runFilePath(scheduleDir(root, run.name), `${run.runId}.result.json`), resultSchema);
}

export async function writeResult(root: string, record: Result & { name: string }): Promise<void> {
  const { name, ...result } = record;
  await writeJson(runFilePath(scheduleDir(root, name), `${result.runId}.result.json`), result);
}

export async function readRunExit(root: string, run: { name: string; runId: string }): Promise<RunExit | null> {
  return readJson(runFilePath(scheduleDir(root, run.name), `${run.runId}.exit.json`), runExitSchema);
}

export async function writeRunExit(root: string, record: RunExit & { name: string }): Promise<void> {
  const { name, ...exit } = record;
  await writeJson(runFilePath(scheduleDir(root, name), `${exit.runId}.exit.json`), exit);
}

export function logPath(root: string, run: { name: string; runId: string }): string {
  return runFilePath(scheduleDir(root, run.name), `${run.runId}.log`);
}

/** Run ids are timestamps, so newest is last by name — no stat calls. */
export async function latestRunId(root: string, name: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(path.join(scheduleDir(root, name), "runs"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  const ids = entries.filter((entry) => entry.endsWith(".log")).map((entry) => entry.slice(0, -".log".length)).sort();
  return ids.at(-1) ?? null;
}

/** The last `count` lines of a run log — the details of a `failed` alert. */
export async function tailLog(logFile: string, count: number): Promise<string> {
  let raw: string;
  try {
    raw = await fs.readFile(logFile, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw e;
  }
  const lines = raw.split("\n");
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  return lines.slice(-count).join("\n");
}

// ─── Alerts ───────────────────────────────────────────────────────────────

export async function writeAlert(root: string, record: Alert): Promise<void> {
  await writeJson(path.join(scheduleDir(root, record.workstream), "alerts", `${record.id}.json`), record);
}

export async function readAlerts(root: string, name: string): Promise<Alert[]> {
  const dir = path.join(scheduleDir(root, name), "alerts");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const alerts: Alert[] = [];
  for (const entry of entries.filter((file) => file.endsWith(".json")).sort()) {
    const alert = await readJson(path.join(dir, entry), alertSchema);
    if (alert !== null) alerts.push(alert);
  }
  return alerts;
}

/** Every alert in the store, for `list` and for `ack <id>` (which is given an
 *  id and no workstream). */
export async function readAllAlerts(root: string): Promise<Alert[]> {
  let names: string[];
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const alerts: Alert[] = [];
  for (const name of names) alerts.push(...(await readAlerts(root, name)));
  return alerts;
}

export const ACK_FADE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * What the default `list` (and the browser) shows: everything open, plus
 * anything acknowledged within the fade window. Records are kept either way —
 * fading is a view, not a deletion.
 */
export function visibleAlerts(alerts: Alert[], nowMs: number): Alert[] {
  return alerts.filter((alert) => {
    if (alert.state === "open") return true;
    if (alert.acknowledgedAt === null) return true;
    return nowMs - Date.parse(alert.acknowledgedAt) < ACK_FADE_MS;
  });
}

// ─── Lock ─────────────────────────────────────────────────────────────────

const lockRecordSchema = z.strictObject({ pid: z.number(), runId: z.string(), at: z.string() });

export type LockResult =
  /** `reclaimed` names the run whose runner died holding this lock: that run's
   *  story was never finished, and the caller owes it an accounting. */
  | { kind: "acquired"; dir: string; reclaimed: { pid: number; runId: string } | null }
  | { kind: "held"; pid: number | null; runId: string | null };

function lockDir(root: string, name: string): string {
  return path.join(scheduleDir(root, name), "lock");
}

/** Grace on top of the run's own timeout before a lock counts as abandoned: the
 *  runner kills an overrunning child and then still has recording to do. */
const LOCK_STALE_GRACE_MS = 30 * 60 * 1000;
/** Floor for the staleness window, so a schedule with a short timeout still
 *  gets the two hours the plan's alerting cadence assumes. */
const LOCK_STALE_FLOOR_MS = 2 * 60 * 60 * 1000;

/** How long a lock for a run with this timeout may be held before it reads as
 *  debris no matter what its PID says. */
export function lockStaleAfterMs(timeoutMs: number): number {
  return Math.max(timeoutMs, LOCK_STALE_FLOOR_MS) + LOCK_STALE_GRACE_MS;
}

/**
 * `kill(pid, 0)` alone is not proof a lock is live: after a reboot the kernel
 * happily hands the dead runner's PID to something unrelated, and the lock is
 * then held forever by a process that never heard of it. Two independent facts
 * about the RECORD settle it — a lock written before the current boot cannot
 * belong to a running process, and one older than the run could possibly take
 * is debris whatever the PID table says.
 */
export function isLockStale(
  held: { at: string },
  probe: { nowMs: number; staleAfterMs: number; bootTimeMs: number | null },
): boolean {
  const atMs = Date.parse(held.at);
  if (Number.isNaN(atMs)) return true;
  if (probe.bootTimeMs !== null && atMs < probe.bootTimeMs) return true;
  return probe.nowMs - atMs >= probe.staleAfterMs;
}

/** When this machine booted, from `kern.boottime`. Null off macOS or when the
 *  answer cannot be parsed — the age rule then carries the reclaim alone. */
export function bootTimeMs(): number | null {
  if (process.platform !== "darwin") return null;
  let raw: string;
  try {
    raw = execFileSync("/usr/sbin/sysctl", ["-n", "kern.boottime"], { encoding: "utf8" });
  } catch {
    return null;
  }
  const match = /sec\s*=\s*(\d+)/u.exec(raw);
  const seconds = match?.[1];
  if (seconds === undefined) return null;
  return Number(seconds) * 1000;
}

/**
 * `mkdir` is the atomic primitive on macOS (no `flock`), with the PID inside so
 * a lock left by a killed runner can be told from a live one. Deps carry the
 * liveness probe so a test can assert both halves without spawning anything.
 */
export async function acquireLock(
  root: string,
  claim: {
    name: string;
    runId: string;
    pid: number;
    isProcessAlive: (pid: number) => boolean;
    at: Date;
    /** Age past which the lock reads as debris even if its PID is alive. */
    staleAfterMs: number;
    /** This machine's boot time; a lock older than it cannot be live. */
    bootTimeMs: number | null;
  },
): Promise<LockResult> {
  const dir = lockDir(root, claim.name);
  const record = { pid: claim.pid, runId: claim.runId, at: claim.at.toISOString() };
  let reclaimed: { pid: number; runId: string } | null = null;
  // The PARENT may not exist yet (the store-root tick lock, a schedule's first
  // run); the lock directory itself is always created non-recursively, because
  // that failure is the mutual exclusion.
  await fs.mkdir(path.dirname(dir), { recursive: true });
  try {
    await fs.mkdir(dir, { recursive: false });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    const held = await readJson(path.join(dir, "owner.json"), lockRecordSchema);
    // A lock whose owner is gone is debris from a crash or a laptop shutdown —
    // reclaiming it is the only way the next tick can finish that run's story.
    const stale = held !== null && isLockStale(held, {
      nowMs: claim.at.getTime(),
      staleAfterMs: claim.staleAfterMs,
      bootTimeMs: claim.bootTimeMs,
    });
    if (held !== null && !stale && claim.isProcessAlive(held.pid)) {
      return { kind: "held", pid: held.pid, runId: held.runId };
    }
    if (held !== null) reclaimed = { pid: held.pid, runId: held.runId };
    await fs.rm(dir, { recursive: true, force: true });
    try {
      await fs.mkdir(dir, { recursive: false });
    } catch (retry) {
      if ((retry as NodeJS.ErrnoException).code !== "EEXIST") throw retry;
      return { kind: "held", pid: held?.pid ?? null, runId: held?.runId ?? null };
    }
  }
  await writeJson(path.join(dir, "owner.json"), record);
  return { kind: "acquired", dir, reclaimed };
}

export async function releaseLock(root: string, name: string): Promise<void> {
  await fs.rm(lockDir(root, name), { recursive: true, force: true });
}

/** Does this PID exist? `kill(pid, 0)` is the question; EPERM means yes, it
 *  exists and belongs to somebody else. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}
