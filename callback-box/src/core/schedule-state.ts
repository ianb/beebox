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

// --- Chat-active locks ---
//
// Chat sessions in the webapp acquire a lock around each SDK run so that
// other processes (notably `cb tick`) can detect a chat is actively
// producing a response and defer housekeeping work that would otherwise
// race with mid-response writes from the agent's tools.

const CHAT_LOCK_DIR_NAME = ".callback-box/active-chats";
const CHAT_LOCK_SUFFIX = ".lock";

export interface ChatLock {
  pid: number;
  startedAt: string;
  /** SDK session id when assigned, otherwise null (new chat hasn't gotten one yet). */
  sessionId: string | null;
}

function chatLockDir(boxRoot: string): string {
  return path.join(boxRoot, CHAT_LOCK_DIR_NAME);
}

export interface AcquireChatLockOptions {
  boxRoot: string;
  /** Stable identifier for the lock filename — typically a per-run uuid. */
  lockId: string;
  sessionId?: string | null;
}

export async function acquireChatActiveLock(options: AcquireChatLockOptions): Promise<string> {
  const dir = chatLockDir(options.boxRoot);
  await fs.mkdir(dir, { recursive: true });
  const lockPath = path.join(dir, `${options.lockId}${CHAT_LOCK_SUFFIX}`);
  const metadata: Record<string, unknown> = {};
  if (options.sessionId !== undefined && options.sessionId !== null) {
    metadata["sessionId"] = options.sessionId;
  }
  await acquireFileLock(lockPath, metadata);
  return lockPath;
}

export async function releaseChatActiveLock(lockPath: string): Promise<void> {
  await releaseFileLock(lockPath);
}

/**
 * Returns active chat-run locks keyed by lockId. Stale locks (dead PID)
 * are cleaned up as a side effect.
 */
export async function loadActiveChats(boxRoot: string): Promise<Map<string, ChatLock>> {
  const holders = await scanLocks(chatLockDir(boxRoot), CHAT_LOCK_SUFFIX);
  const result = new Map<string, ChatLock>();
  for (const [lockId, holder] of holders) {
    const sessionId = holder.metadata["sessionId"];
    result.set(lockId, {
      pid: holder.pid,
      startedAt: holder.acquiredAt,
      sessionId: typeof sessionId === "string" ? sessionId : null,
    });
  }
  return result;
}

/**
 * A run card whose mtime is older than this is treated as orphaned —
 * the engine has no signal handler, so when a procedure process is
 * killed (script-timeout, OOM, crash) the run card stays at its
 * last-written status forever. Anything actively running updates the
 * card on every step boundary, and `cb tick` kills scripts after 10
 * minutes regardless. One hour leaves headroom for unusually long
 * agent steps without letting a months-old corpse block housekeeping.
 */
const STALE_RUN_CARD_AGE_MS = 60 * 60 * 1000;

/**
 * Return the names of any procedure runs whose root status is non-terminal
 * (pending or running) AND whose run card has been touched recently. Used
 * to gate housekeeping/tick activity so the system can be "fully at rest"
 * before scheduled work fires.
 *
 * Reads `procedure/runs/<runDir>/run.procedure-run.card` and matches the
 * root `status="..."` attribute via regex — full XML parsing is overkill
 * here and would couple this helper to the schemas package. Stale cards
 * (older than STALE_RUN_CARD_AGE_MS) are skipped so an orphaned card from
 * a long-dead procedure doesn't permanently block the at-rest gate.
 */
export async function loadRunningProcedures(boxRoot: string): Promise<string[]> {
  const runsDir = path.join(boxRoot, "procedure/runs");
  let entries: string[];
  try {
    entries = await fs.readdir(runsDir);
  } catch {
    return [];
  }
  const now = Date.now();
  const running: string[] = [];
  for (const entry of entries) {
    const cardPath = path.join(runsDir, entry, "run.procedure-run.card");
    let mtimeMs: number;
    let content: string;
    try {
      const stat = await fs.stat(cardPath);
      mtimeMs = stat.mtimeMs;
    } catch {
      continue;
    }
    if (now - mtimeMs > STALE_RUN_CARD_AGE_MS) continue;
    try {
      content = await fs.readFile(cardPath, "utf-8");
    } catch {
      continue;
    }
    if (/<procedure-run[^>]*\bstatus=["'](?:pending|running)["']/.test(content)) {
      running.push(entry);
    }
  }
  return running;
}
