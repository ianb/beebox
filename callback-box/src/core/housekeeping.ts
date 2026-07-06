/**
 * Housekeeping tasks that run during sync.
 *
 * These are deterministic cleanup operations that don't require
 * an agent — they can run automatically before job processing.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getBoxTime } from "../lib/time.js";

/**
 * Sweep transient chat-upload files from <boxRoot>/tmp/.
 *
 * The chat composer uploads files here before referencing them in messages.
 * Once the agent has read them, they linger — this removes anything older
 * than 7 days. The directory itself is gitignored, so no commit is needed.
 */
export async function cleanupOldTmpUploads(
  boxRoot: string,
  onLog?: (msg: string) => void,
): Promise<number> {
  const EXPIRY_DAYS = 7;
  const now = getBoxTime(boxRoot).getTime();
  const expiryMs = EXPIRY_DAYS * 24 * 60 * 60 * 1000;

  const tmpDir = path.join(boxRoot, "tmp");
  let entries: string[];
  try {
    entries = await fs.readdir(tmpDir);
  } catch (e) {
    // tmp/ may not exist yet (no uploads ever made) — nothing to clean.
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.debug(`cleanupOldTmpUploads: cannot read ${tmpDir}, skipping:`, e);
    }
    return 0;
  }

  let removed = 0;
  for (const entry of entries) {
    const fullPath = path.join(tmpDir, entry);
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(fullPath);
    } catch (e) {
      // Entry vanished between readdir and stat (race), or is unreadable —
      // skip it; the next sweep will catch it if it still matters.
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        console.debug(`cleanupOldTmpUploads: cannot stat ${fullPath}, skipping:`, e);
      }
      continue;
    }
    if (!stat.isFile()) continue;
    if (now - stat.mtimeMs <= expiryMs) continue;

    try {
      await fs.unlink(fullPath);
      removed++;
      const ageDays = Math.floor((now - stat.mtimeMs) / (24 * 60 * 60 * 1000));
      onLog?.(`  Removed: tmp/${entry} (${ageDays} days old)`);
    } catch (err) {
      onLog?.(`  Warning: could not remove tmp/${entry}: ${(err as Error).message}`);
    }
  }

  if (removed > 0) {
    onLog?.(`  Removed ${removed} stale upload(s) from tmp/`);
  }
  return removed;
}
