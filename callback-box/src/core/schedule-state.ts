/**
 * Schedule state tracking for scheduled scripts.
 *
 * State is machine-local (gitignored) — last-run timestamps
 * aren't meaningful across machines.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import lockfile from "proper-lockfile";

export interface RunRecord {
  ts: string;
  durationMs: number;
  sleepAffected?: boolean;
}

export interface ScriptState {
  lastRun: string | null;
  lastResult: "success" | "failure" | null;
  lastError: string | null;
  runCount: number;
  recentRuns?: RunRecord[];
}

const EMPTY_STATE: ScriptState = {
  lastRun: null,
  lastResult: null,
  lastError: null,
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

const SCRIPT_LOCK_STALE_MS = 10 * 60 * 1000; // 10 minutes

export interface ScriptLock {
  pid: number;
  startedAt: string;
  triggeredBy: string;
  lockGroup?: string;
}

function lockFilePath(boxRoot: string, scriptName: string): string {
  return path.join(stateDir(boxRoot), `${scriptName}.lock`);
}

export async function acquireScriptLock(
  opts: { boxRoot: string; scriptName: string; triggeredBy: string; lockGroup?: string },
): Promise<void> {
  const dir = stateDir(opts.boxRoot);
  await fs.mkdir(dir, { recursive: true });
  const lockPath = lockFilePath(opts.boxRoot, opts.scriptName);

  // Ensure the lock file exists (proper-lockfile requires it)
  await fs.writeFile(lockPath, "", { flag: "a" });
  await lockfile.lock(lockPath, { stale: SCRIPT_LOCK_STALE_MS, retries: 0 });

  // Write metadata to the lock file
  const lock: ScriptLock = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    triggeredBy: opts.triggeredBy,
    ...(opts.lockGroup ? { lockGroup: opts.lockGroup } : {}),
  };
  await fs.writeFile(lockPath, JSON.stringify(lock) + "\n");
}

export async function releaseScriptLock(
  opts: { boxRoot: string; scriptName: string },
): Promise<void> {
  const lockPath = lockFilePath(opts.boxRoot, opts.scriptName);
  try {
    await lockfile.unlock(lockPath);
  } catch {
    // Already unlocked or lock file missing
  }
  await fs.unlink(lockPath).catch(() => {});
}

/**
 * Read all lock files, check if locks are held, remove stale locks.
 * Returns a map of scriptName → ScriptLock for currently running scripts.
 */
export async function loadRunningScripts(boxRoot: string): Promise<Map<string, ScriptLock>> {
  const dir = stateDir(boxRoot);
  const running = new Map<string, ScriptLock>();

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return running;
  }

  const lockFiles = entries.filter((f) => f.endsWith(".lock") && !f.endsWith(".lock.lock"));

  for (const file of lockFiles) {
    const scriptName = file.replace(".lock", "");
    const fullPath = path.join(dir, file);

    try {
      const isLocked = await lockfile.check(fullPath, { stale: SCRIPT_LOCK_STALE_MS });
      if (!isLocked) {
        // Stale or released — clean up
        await fs.unlink(fullPath).catch(() => {});
        continue;
      }

      const content = await fs.readFile(fullPath, "utf-8");
      const lock = JSON.parse(content) as ScriptLock;
      running.set(scriptName, lock);
    } catch {
      // Malformed lock file or check failed — clean up
      await fs.unlink(fullPath).catch(() => {});
    }
  }

  return running;
}
