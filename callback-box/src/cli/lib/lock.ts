/**
 * Lock file management for wakeup mutex.
 *
 * Prevents concurrent wakeup processes from running.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

const LOCK_FILE = ".cb-lock";

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

  // Check if lock exists
  try {
    const content = await fs.readFile(lockPath, "utf-8");
    const existing = JSON.parse(content) as LockInfo;

    // Check if the process is still running
    if (await isProcessRunning(existing.pid)) {
      return null; // Lock is held by active process
    }

    // Stale lock, clean it up
    console.log(`Removing stale lock from PID ${existing.pid}`);
    await fs.unlink(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    // Lock doesn't exist, we can acquire it
  }

  // Create lock file
  const lockInfo: LockInfo = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    hostname: process.env["HOSTNAME"] ?? "localhost",
  };

  try {
    // Use exclusive write to prevent race conditions
    await fs.writeFile(lockPath, JSON.stringify(lockInfo, null, 2), {
      flag: "wx",
    });
    return lockInfo;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      // Another process acquired the lock first
      return null;
    }
    throw error;
  }
}

/**
 * Release the wakeup lock.
 *
 * @param boxRoot - The box root directory
 */
export async function releaseLock(boxRoot: string): Promise<void> {
  const lockPath = path.join(boxRoot, LOCK_FILE);

  try {
    // Verify we own the lock before removing
    const content = await fs.readFile(lockPath, "utf-8");
    const existing = JSON.parse(content) as LockInfo;

    if (existing.pid !== process.pid) {
      console.warn(`Lock is held by different process (PID ${existing.pid}), not releasing`);
      return;
    }

    await fs.unlink(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    // Lock already removed, that's fine
  }
}

/**
 * Get current lock info if locked.
 *
 * @param boxRoot - The box root directory
 * @returns Lock info or null if not locked
 */
export async function getLockInfo(boxRoot: string): Promise<LockInfo | null> {
  const lockPath = path.join(boxRoot, LOCK_FILE);

  try {
    const content = await fs.readFile(lockPath, "utf-8");
    return JSON.parse(content) as LockInfo;
  } catch {
    return null;
  }
}

/**
 * Check if a process is running.
 */
async function isProcessRunning(pid: number): Promise<boolean> {
  try {
    // Sending signal 0 doesn't kill the process but checks if it exists
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
