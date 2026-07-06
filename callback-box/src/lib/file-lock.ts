/**
 * Machine-local file lock primitive.
 *
 * This is the canonical lock for the project. All cross-process locks
 * (wakeup mutex in cli/lib/lock.ts, scheduled-script + lock-group locks
 * in core/schedule-state.ts, reactor mutex in core/reactor/engine.ts) sit
 * on top of it. Don't add a new lock surface elsewhere — extend or wrap
 * this instead.
 *
 * ## How it works
 *
 * The lock *is* a single JSON file at the caller-chosen path. Acquisition
 * is atomic via `fs.open(path, "wx")` (O_CREAT|O_EXCL). The file body
 * carries the holder's identity:
 *
 *   { pid, bootEpochSeconds, hostname, acquiredAt, metadata }
 *
 * Liveness is checked directly with `process.kill(pid, 0)` plus a
 * boot-epoch comparison (`Date.now()/1000 - os.uptime()`, ±30s tolerance
 * for NTP jitter). PID-reuse after a reboot is caught by the boot-epoch
 * mismatch. Different hostname → treated as live and never reclaimed.
 *
 * Dead holders self-heal: any read path that finds a holder whose PID is
 * gone (or whose boot epoch differs by more than the tolerance) deletes
 * the file and proceeds. Malformed JSON / missing required fields are
 * treated the same way.
 *
 * ## Why not proper-lockfile / mtime staleness?
 *
 * The previous implementation used `proper-lockfile`, which detects stale
 * locks via mtime heartbeats. Two failure modes drove the rewrite:
 *
 *   1. macOS sleep paused the heartbeat, so live locks looked stale on
 *      wake and got stolen.
 *   2. SIGKILL (e.g. a per-script timeout firing) left orphaned
 *      `.lock.lock` directories that no code path cleaned up.
 *
 * PID-based liveness is immune to both: process state is the source of
 * truth, no clocks involved.
 *
 * ## Scope
 *
 * Single machine. The state directories that consume this primitive
 * (`config/schedules/.state/`, `.cb-lock`, `.cb-reactor.lock`) are
 * gitignored, so cross-machine contention is out of scope. The hostname
 * field is recorded for inspectability and to defensively skip cleanup
 * of locks owned by another host.
 *
 * In-process async serialization (e.g. capture.ts's per-session promise
 * chain) is a different problem — there's no other process to coordinate
 * with, only concurrent async tasks within one Node process. Use a
 * `Map<id, Promise>` for that, not file locks (see `card-lock.ts` and
 * `capture-session-store.ts`).
 *
 * ## Lock table (every lock in the system)
 *
 * Consult this before adding a lock so the new one has an ordering
 * convention to fit into. "cross-proc" = this file's PID-based file lock;
 * "in-proc" = a `Map<key, Promise>` chain within one Node process.
 *
 * | Lock | Kind | Path / key | Scope (what it guards) | Held by | Typical hold |
 * |------|------|-----------|------------------------|---------|-------------|
 * | Reactor mutex | cross-proc | `<box>/.cb-reactor.lock` | one reactor cycle per box | reactor engine (`cb wakeup`) | one cycle (s–min) |
 * | Scheduled-script | cross-proc | `<box>/config/schedules/.state/<script>.lock` (+ lock-group ids) | one run per script / lock-group | scheduler (`cb tick`, `scheduler.trigger`) | one script run |
 * | Chat-active | cross-proc | `<box>/.callback-box/active-chats/<runId>.lock` | signals a live SDK chat run so tick/housekeeping defer | `ChatSession` run | one SDK chat turn |
 * | Push store | cross-proc | `<pushStoreDir>/push-subscriptions.json.lock` | server-wide subscription store RMW | push subscribe/unsubscribe | single RMW (ms) |
 * | Search index | cross-proc | `<box>/.callback-box/<lock file>` | index refresh serialization | `search/refresh.ts` | one index rebuild |
 * | Capture session | in-proc (`withSessionLock`) | session id | per-`session.json` RMW (concurrent uploads) | capture upload route; entry dropped by `cleanupSession` | single RMW |
 * | Card write | in-proc (`withCardLock`) | `path.resolve(file)` | per-file card/config read-modify-write within one process | tRPC mutations (todos/scheduler/admin), connector thread writes, `answer`/`transcription` core; map self-drains | single RMW |
 * | Git index | git-owned | `<box>/.git/index.lock` | staging/commit | any `git commit` (not ours) | retried once on collision (`cli/lib/git.ts`) |
 *
 * Ordering notes. The cross-process and in-process tiers are orthogonal —
 * different failure models, no shared key space. In-process: `withCardLock`
 * is per file; never nest it on the *same* path (it throws
 * `ReentrantCardLockError` rather than deadlock). A `withCardLock` critical
 * section deliberately spans the git stage+commit that follows the write, so
 * it briefly touches the whole-repo git index — but `withCardLock` only
 * serializes same-file racers, so two *different* cards committing at once
 * can still race on `.git/index.lock` (handled by git.ts's retry, not by
 * these locks; the git-commit race is a separate concern). Avoid holding two
 * `withCardLock` locks on different files in inconsistent order across call
 * sites.
 *
 * ## API
 *
 * - `acquireLock(path, metadata)` — atomic; throws LockHeldError if a
 *   live holder owns it. Reclaims dead/malformed holders automatically.
 * - `releaseLock(path)` — idempotent; only deletes the file if the
 *   recorded holder is us (PID + bootEpoch + hostname).
 * - `inspectLock(path)` — read holder; returns null if not held or dead
 *   (cleans up dead as a side effect).
 * - `forceAcquireLock(path, metadata)` — steal whoever owns it.
 * - `scanLocks(dir, suffix)` — read all matching lock files; returns a
 *   map of name → holder for live ones, deletes dead ones.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";

export interface LockHolder {
  pid: number;
  bootEpochSeconds: number;
  hostname: string;
  acquiredAt: string;
  metadata: Record<string, unknown>;
}

export class LockHeldError extends Error {
  readonly holder: LockHolder;
  constructor(holder: LockHolder) {
    super(`Lock held by pid ${holder.pid} on ${holder.hostname} (acquired ${holder.acquiredAt})`);
    this.name = "LockHeldError";
    this.holder = holder;
  }
}

class LockAcquireFailedError extends Error {
  constructor(readonly path: string) {
    super(`Failed to acquire lock at ${path} after retry`);
    this.name = "LockAcquireFailedError";
  }
}

class LockForceAcquireFailedError extends Error {
  constructor(readonly path: string) {
    super(`Failed to force-acquire lock at ${path}`);
    this.name = "LockForceAcquireFailedError";
  }
}

// Tolerance window for boot-epoch comparison. NTP corrections at startup
// can shift Date.now()-os.uptime() by a few seconds; a real reboot is well
// outside this window, so we still detect it.
const BOOT_TOLERANCE_SECONDS = 30;

function currentBootEpochSeconds(): number {
  return Math.floor(Date.now() / 1000 - os.uptime());
}

function sameBoot(a: number, b: number): boolean {
  return Math.abs(a - b) <= BOOT_TOLERANCE_SECONDS;
}

function makeHolder(metadata: Record<string, unknown>): LockHolder {
  return {
    pid: process.pid,
    bootEpochSeconds: currentBootEpochSeconds(),
    hostname: os.hostname(),
    acquiredAt: new Date().toISOString(),
    metadata,
  };
}

function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    // EPERM means the process exists but we can't signal it (different uid).
    // Anything unexpected — be conservative and treat as live.
    return true;
  }
}

/**
 * Decide whether a recorded lock holder is still alive on this machine.
 * Cross-host holders are always treated as alive (we can't introspect them).
 */
function isHolderLive(holder: LockHolder): boolean {
  if (holder.hostname !== os.hostname()) return true;
  if (!sameBoot(holder.bootEpochSeconds, currentBootEpochSeconds())) return false;
  return pidExists(holder.pid);
}

function isOurs(holder: LockHolder): boolean {
  return holder.pid === process.pid &&
    holder.hostname === os.hostname() &&
    sameBoot(holder.bootEpochSeconds, currentBootEpochSeconds());
}

function isWellFormedHolder(value: unknown): value is LockHolder {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v["pid"] === "number" &&
    typeof v["bootEpochSeconds"] === "number" &&
    typeof v["hostname"] === "string" &&
    typeof v["acquiredAt"] === "string" &&
    typeof v["metadata"] === "object" && v["metadata"] !== null;
}

async function readHolder(path: string): Promise<LockHolder | null> {
  let content: string;
  try {
    content = await fs.readFile(path, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    return null;
  }
  const trimmed = content.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (_e) {
    // Malformed JSON — treat as no holder so it can be reclaimed.
    return null;
  }
  if (!isWellFormedHolder(parsed)) return null;
  return parsed;
}

async function writeExclusive(path: string, holder: LockHolder): Promise<boolean> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(path, "wx");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return false;
    throw err;
  }
  try {
    await handle.writeFile(JSON.stringify(holder, null, 2) + "\n");
  } finally {
    await handle.close();
  }
  return true;
}

async function unlinkIgnoringMissing(path: string): Promise<void> {
  try {
    await fs.unlink(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw err;
  }
}

/**
 * Atomically acquire a lock. Throws LockHeldError if a live holder owns it.
 * Dead holders (crashed, killed, post-reboot) are reclaimed automatically.
 */
export async function acquireLock(
  path: string,
  metadata: Record<string, unknown>,
): Promise<LockHolder> {
  const holder = makeHolder(metadata);

  if (await writeExclusive(path, holder)) return holder;

  // File exists. Check who owns it.
  const existing = await readHolder(path);
  if (existing && isHolderLive(existing)) {
    throw new LockHeldError(existing);
  }

  // Existing is dead or malformed. Reclaim and retry once.
  await unlinkIgnoringMissing(path);
  if (await writeExclusive(path, holder)) return holder;

  // Race: someone else acquired between our unlink and write.
  const winner = await readHolder(path);
  if (winner && isHolderLive(winner)) {
    throw new LockHeldError(winner);
  }
  throw new LockAcquireFailedError(path);
}

/**
 * Release a lock previously acquired by this process. Idempotent.
 * If the lock is now owned by someone else (we crashed, they reclaimed),
 * we leave their lock alone.
 */
export async function releaseLock(path: string): Promise<void> {
  const existing = await readHolder(path);
  if (existing === null) return;
  if (!isOurs(existing)) return;
  await unlinkIgnoringMissing(path);
}

/**
 * Read the current holder of a lock, or null if not held.
 * Dead holders are cleaned up as a side effect.
 */
export async function inspectLock(path: string): Promise<LockHolder | null> {
  const existing = await readHolder(path);
  if (existing === null) return null;
  if (!isHolderLive(existing)) {
    await unlinkIgnoringMissing(path);
    return null;
  }
  return existing;
}

/**
 * Forcefully take a lock, evicting whatever is there (live or dead).
 * Use only when the caller has decided to override an active holder.
 */
export async function forceAcquireLock(
  path: string,
  metadata: Record<string, unknown>,
): Promise<LockHolder> {
  await unlinkIgnoringMissing(path);
  const holder = makeHolder(metadata);
  if (await writeExclusive(path, holder)) return holder;
  // Race with another acquirer; one more shot.
  await unlinkIgnoringMissing(path);
  if (await writeExclusive(path, holder)) return holder;
  throw new LockForceAcquireFailedError(path);
}

/**
 * Scan a directory for lock files matching the given suffix. Returns a map
 * of name (filename without suffix) to live holder. Dead holders are cleaned
 * up as a side effect.
 */
export async function scanLocks(
  dir: string,
  suffix: string,
): Promise<Map<string, LockHolder>> {
  const result = new Map<string, LockHolder>();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return result;
    throw err;
  }
  for (const entry of entries) {
    if (!entry.endsWith(suffix)) continue;
    const fullPath = `${dir}/${entry}`;
    const holder = await readHolder(fullPath);
    if (holder === null) {
      await unlinkIgnoringMissing(fullPath);
      continue;
    }
    if (!isHolderLive(holder)) {
      await unlinkIgnoringMissing(fullPath);
      continue;
    }
    const name = entry.slice(0, -suffix.length);
    result.set(name, holder);
  }
  return result;
}
