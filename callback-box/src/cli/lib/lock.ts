/**
 * Lock file management for wakeup mutex.
 *
 * Prevents concurrent wakeup processes from running.
 * Uses proper-lockfile for atomic lock acquisition (mkdir-based)
 * with mtime-based stale detection.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import lockfile from "proper-lockfile";

const LOCK_FILE = ".cb-lock";
const LOCK_STALE_MS = 5 * 60 * 1000; // 5 minutes

export interface LockInfo {
  pid: number;
  startedAt: string;
  hostname: string;
}

/**
 * Attempt to acquire the wakeup lock.
 *
 * @param boxRoot - The box root directory
 * @returns Lock info if acquired, null if already locked
 */
export async function acquireLock(boxRoot: string): Promise<LockInfo | null> {
  const lockPath = path.join(boxRoot, LOCK_FILE);

  // Ensure the lock file exists (proper-lockfile requires it)
  await fs.writeFile(lockPath, "", { flag: "a" });

  try {
    await lockfile.lock(lockPath, { stale: LOCK_STALE_MS, retries: 0 });
  } catch {
    return null; // Already locked or couldn't acquire
  }

  // Write metadata to the lock file
  const lockInfo: LockInfo = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    hostname: process.env["HOSTNAME"] ?? "localhost",
  };

  await fs.writeFile(lockPath, JSON.stringify(lockInfo, null, 2));
  return lockInfo;
}

/**
 * Release the wakeup lock.
 *
 * @param boxRoot - The box root directory
 */
export async function releaseLock(boxRoot: string): Promise<void> {
  const lockPath = path.join(boxRoot, LOCK_FILE);

  try {
    await lockfile.unlock(lockPath);
  } catch {
    // Already unlocked or lock file missing
  }
}

/**
 * Get current lock info if locked.
 * Returns null if not locked (or lock is stale).
 *
 * @param boxRoot - The box root directory
 * @returns Lock info or null if not locked
 */
export async function getLockInfo(boxRoot: string): Promise<LockInfo | null> {
  const lockPath = path.join(boxRoot, LOCK_FILE);

  try {
    const isLocked = await lockfile.check(lockPath, { stale: LOCK_STALE_MS });
    if (!isLocked) return null;

    const content = await fs.readFile(lockPath, "utf-8");
    return JSON.parse(content) as LockInfo;
  } catch {
    return null;
  }
}
