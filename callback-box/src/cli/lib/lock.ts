/**
 * Box-level wakeup mutex. Prevents concurrent wakeup-style processes
 * (process-feedback, process-news, triage-feedback) from running on
 * the same box at the same time.
 *
 * Backed by the file-lock primitive in src/lib/file-lock.ts.
 */

import * as path from "node:path";
import {
  acquireLock as acquireFileLock,
  releaseLock as releaseFileLock,
  inspectLock,
  LockHeldError,
} from "../../lib/file-lock.js";

const LOCK_FILE = ".cb-lock";

export interface LockInfo {
  pid: number;
  startedAt: string;
  hostname: string;
}

function lockPath(boxRoot: string): string {
  return path.join(boxRoot, LOCK_FILE);
}

/**
 * Attempt to acquire the wakeup lock.
 * Returns LockInfo on success, null if a live holder owns it.
 */
export async function acquireLock(boxRoot: string): Promise<LockInfo | null> {
  try {
    const holder = await acquireFileLock(lockPath(boxRoot), {});
    return {
      pid: holder.pid,
      startedAt: holder.acquiredAt,
      hostname: holder.hostname,
    };
  } catch (err) {
    if (err instanceof LockHeldError) return null;
    throw err;
  }
}

/**
 * Release the wakeup lock. Idempotent; only deletes the lock file if we
 * are still the recorded owner.
 */
export async function releaseLock(boxRoot: string): Promise<void> {
  await releaseFileLock(lockPath(boxRoot));
}

/**
 * Get the current lock holder, or null if not held (or held by a dead process).
 */
export async function getLockInfo(boxRoot: string): Promise<LockInfo | null> {
  const holder = await inspectLock(lockPath(boxRoot));
  if (holder === null) return null;
  return {
    pid: holder.pid,
    startedAt: holder.acquiredAt,
    hostname: holder.hostname,
  };
}
