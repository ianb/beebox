/**
 * Machine-local file lock primitive.
 *
 * The lock file itself contains the holder's metadata as JSON (pid, boot
 * epoch, hostname, timestamp, caller-supplied fields). Liveness is checked
 * directly via process.kill(pid, 0) rather than mtime-based stale detection,
 * which makes the lock robust under macOS sleep and after SIGKILL.
 *
 * Designed for single-machine use: the state directories that consume this
 * are gitignored, so cross-machine concurrency is not in scope. We still
 * record hostname and refuse to clean cross-host locks defensively.
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
  throw new Error(`Failed to acquire lock at ${path} after retry`);
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
  throw new Error(`Failed to force-acquire lock at ${path}`);
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
