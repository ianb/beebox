/**
 * Housekeeping tasks that run during sync.
 *
 * These are deterministic cleanup operations that don't require
 * an agent — they can run automatically before job processing.
 */

import * as fs from "node:fs/promises";
import type { Stats } from "node:fs";
import * as path from "node:path";
import { getBoxTime } from "../lib/time.js";
import { errnoCode, errorMessage } from "../lib/error-guards.js";
import { boxTmpDir, chatUploadBatchesDir } from "../lib/box-tmp.js";

/**
 * Sweep transient chat-upload files from <boxRoot>/_tmp/.
 *
 * The chat composer uploads files here before referencing them in messages.
 * Once the agent has read them, they linger — this removes anything older
 * than 7 days. The directory itself is gitignored, so no commit is needed.
 *
 * Two layouts: files flat in `_tmp/` (older clients, and other scratch), aged
 * by their own mtime; and one directory per chat message under
 * `_tmp/chat/<batch>/` (`webapp/routes/chat-uploads.ts`), aged by its newest
 * file and removed whole. Other directories are left alone — some own their
 * own lifecycle (`_tmp/scan-quarantine/`, `core/scan/promote-gc.ts`).
 */
export async function cleanupOldTmpUploads(
  boxRoot: string,
  onLog?: (msg: string) => void,
): Promise<number> {
  const EXPIRY_DAYS = 7;
  const now = getBoxTime(boxRoot).getTime();
  const expiryMs = EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  const tmpDir = boxTmpDir(boxRoot);
  const isStale = (mtimeMs: number) => now - mtimeMs > expiryMs;
  const ageDays = (mtimeMs: number) => Math.floor((now - mtimeMs) / (24 * 60 * 60 * 1000));

  let removed = 0;
  for (const entry of await listEntries(tmpDir)) {
    const stat = await statOrNull(path.join(tmpDir, entry));
    if (stat === null || !stat.isFile() || !isStale(stat.mtimeMs)) continue;
    try {
      await fs.unlink(path.join(tmpDir, entry));
      removed++;
      onLog?.(`  Removed: _tmp/${entry} (${String(ageDays(stat.mtimeMs))} days old)`);
    } catch (err) {
      onLog?.(`  Warning: could not remove _tmp/${entry}: ${errorMessage(err)}`);
    }
  }

  const batchesDir = chatUploadBatchesDir(boxRoot);
  const batchesLabel = path.relative(boxRoot, batchesDir);
  for (const batch of await listEntries(batchesDir)) {
    const dir = path.join(batchesDir, batch);
    const stat = await statOrNull(dir);
    if (stat === null || !stat.isDirectory()) continue;
    const newest = await newestMtime(dir, stat.mtimeMs);
    if (!isStale(newest)) continue;
    try {
      await fs.rm(dir, { recursive: true, force: true });
      removed++;
      onLog?.(`  Removed: ${batchesLabel}/${batch}/ (${String(ageDays(newest))} days old)`);
    } catch (err) {
      onLog?.(`  Warning: could not remove ${batchesLabel}/${batch}/: ${errorMessage(err)}`);
    }
  }

  if (removed > 0) {
    onLog?.(`  Removed ${String(removed)} stale upload(s) from _tmp/`);
  }
  return removed;
}

/** The directory's entries, or none when it does not exist yet. */
async function listEntries(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch (e) {
    // The dir may not exist yet (no uploads ever made) — nothing to clean.
    if (errnoCode(e) !== "ENOENT") {
      console.debug(`cleanupOldTmpUploads: cannot read ${dir}, skipping:`, e);
    }
    return [];
  }
}

/** Stat, or null when the entry vanished between readdir and stat (a race) or is unreadable. */
async function statOrNull(fullPath: string): Promise<Stats | null> {
  try {
    return await fs.stat(fullPath);
  } catch (e) {
    // Skip it; the next sweep will catch it if it still matters.
    if (errnoCode(e) !== "ENOENT") {
      console.debug(`cleanupOldTmpUploads: cannot stat ${fullPath}, skipping:`, e);
    }
    return null;
  }
}

/**
 * The newest mtime among a batch directory's files, at any depth, or the
 * directory's own when it holds none. Only files count: a directory's mtime
 * says when its listing changed, not when anything in it was written.
 */
async function newestMtime(dir: string, dirMtimeMs: number): Promise<number> {
  const newestFile = await newestFileMtime(dir);
  return newestFile ?? dirMtimeMs;
}

async function newestFileMtime(dir: string): Promise<number | null> {
  let newest: number | null = null;
  for (const entry of await listEntries(dir)) {
    const full = path.join(dir, entry);
    const stat = await statOrNull(full);
    if (stat === null) continue;
    const candidate = stat.isDirectory() ? await newestFileMtime(full) : stat.mtimeMs;
    if (candidate !== null && (newest === null || candidate > newest)) newest = candidate;
  }
  return newest;
}
