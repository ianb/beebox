/**
 * Schedule state tracking for scheduled scripts.
 *
 * State is machine-local (gitignored) — last-run timestamps
 * aren't meaningful across machines.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  acquireLock as acquireFileLock,
  releaseLock as releaseFileLock,
  scanLocks,
  LockHeldError,
} from "../lib/file-lock.js";

export interface RunRecord {
  ts: string;
  durationMs: number;
  sleepAffected?: boolean;
}

export interface ScriptState {
  lastRun: string | null;
  lastResult: "success" | "failure" | null;
  lastError: string | null;
  lastDurationMs: number | null;
  runCount: number;
  recentRuns?: RunRecord[];
}

const EMPTY_STATE: ScriptState = {
  lastRun: null,
  lastResult: null,
  lastError: null,
  lastDurationMs: null,
  runCount: 0,
};

function stateDir(boxRoot: string): string {
  return path.join(boxRoot, "config/schedules/.state");
}

function stateFile(boxRoot: string, scriptName: string): string {
  return path.join(stateDir(boxRoot), `${scriptName}.json`);
}

/**
 * Load the run state for a script, or return empty state if none exists.
 */
export async function loadScriptState(boxRoot: string, scriptName: string): Promise<ScriptState> {
  try {
    const content = await fs.readFile(stateFile(boxRoot, scriptName), "utf-8");
    return JSON.parse(content) as ScriptState;
  } catch {
    return { ...EMPTY_STATE };
  }
}

export interface SaveStateOptions {
  boxRoot: string;
  scriptName: string;
  state: ScriptState;
}

/**
 * Save the run state for a script.
 */
export async function saveScriptState(opts: SaveStateOptions): Promise<void> {
  const dir = stateDir(opts.boxRoot);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    stateFile(opts.boxRoot, opts.scriptName),
    JSON.stringify(opts.state, null, 2) + "\n"
  );
}

/**
 * Remove run records older than the given window (in ms).
 * Returns a new array (or undefined if empty).
 */
export function pruneRecentRuns(
  runs: RunRecord[] | undefined,
  opts: { windowMs: number; now: Date },
): RunRecord[] | undefined {
  if (!runs || runs.length === 0) return undefined;
  const cutoff = opts.now.getTime() - opts.windowMs;
  const kept = runs.filter((r) => new Date(r.ts).getTime() >= cutoff);
  return kept.length > 0 ? kept : undefined;
}

/**
 * Record a run and prune old entries.
 */
export function recordRun(
  state: ScriptState,
  opts: { record: RunRecord; windowMs: number; now: Date },
): void {
  const runs = state.recentRuns ?? [];
  runs.push(opts.record);
  const pruned = pruneRecentRuns(runs, { windowMs: opts.windowMs, now: opts.now });
  if (pruned) {
    state.recentRuns = pruned;
  } else {
    delete state.recentRuns;
  }
}

// --- Lock files for running script tracking ---

export interface ScriptLock {
  pid: number;
  startedAt: string;
  triggeredBy: string;
  lockGroup?: string;
}

const LOCK_SUFFIX = ".lock";

function lockFilePath(boxRoot: string, scriptName: string): string {
  return path.join(stateDir(boxRoot), `${scriptName}${LOCK_SUFFIX}`);
}

export async function acquireScriptLock(
  opts: { boxRoot: string; scriptName: string; triggeredBy: string; lockGroup?: string },
): Promise<void> {
  const dir = stateDir(opts.boxRoot);
  await fs.mkdir(dir, { recursive: true });
  const metadata: Record<string, unknown> = { triggeredBy: opts.triggeredBy };
  if (opts.lockGroup) metadata["lockGroup"] = opts.lockGroup;
  try {
    await acquireFileLock(lockFilePath(opts.boxRoot, opts.scriptName), metadata);
  } catch (err) {
    if (err instanceof LockHeldError) {
      throw new Error(`Script "${opts.scriptName}" is already running (pid ${err.holder.pid})`);
    }
    throw err;
  }
}

export async function releaseScriptLock(
  opts: { boxRoot: string; scriptName: string },
): Promise<void> {
  await releaseFileLock(lockFilePath(opts.boxRoot, opts.scriptName));
}

/**
 * Returns a map of scriptName → ScriptLock for currently running scripts.
 * Stale locks (dead PID, post-reboot) are cleaned up as a side effect.
 */
export async function loadRunningScripts(boxRoot: string): Promise<Map<string, ScriptLock>> {
  const holders = await scanLocks(stateDir(boxRoot), LOCK_SUFFIX);
  const running = new Map<string, ScriptLock>();
  for (const [scriptName, holder] of holders) {
    const triggeredBy = holder.metadata["triggeredBy"];
    const lockGroup = holder.metadata["lockGroup"];
    const lock: ScriptLock = {
      pid: holder.pid,
      startedAt: holder.acquiredAt,
      triggeredBy: typeof triggeredBy === "string" ? triggeredBy : "unknown",
      ...(typeof lockGroup === "string" ? { lockGroup } : {}),
    };
    running.set(scriptName, lock);
  }
  return running;
}
