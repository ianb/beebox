/**
 * Housekeeping tasks that run during sync.
 *
 * These are deterministic cleanup operations that don't require
 * an agent — they can run automatically before job processing.
 */

import * as fs from "node:fs/promises";
import type { Stats } from "node:fs";
import * as path from "node:path";
import { errnoCode, errorMessage } from "../shared/error-guards.js";
import { boxTmpDir, chatUploadBatchesDir } from "../lib/box-tmp.js";

/**
 * `_tmp/` directories that own their lifecycle and are never swept here:
 * staged capture sessions are durable until processed (`core/capture/staging-schema.ts`),
 * and scan quarantine has its own GC (`core/scan/promote/gc.ts`).
 */
const OWNED_TMP_DIRS = new Set(["capture-staging", "scan-quarantine"]);

/**
 * `_tmp/` directories of independent files, each aged by its own mtime:
 * box-browser screenshots and card captures (`core/browser/`).
 */
const PER_FILE_TMP_DIRS = new Set(["browser"]);

interface Sweep { isStale: (mtimeMs: number) => boolean; ageDays: (mtimeMs: number) => number; boxRoot: string; onLog: ((msg: string) => void) | undefined }

/** A `_tmp/` entry and its mtime; `isDir` marks its log label with "/". */
interface Entry { path: string; mtimeMs: number; isDir?: boolean }

/**
 * Sweep stale scratch from <boxRoot>/_tmp/: anything a week old or more.
 * The directory is gitignored, so no commit is needed.
 *
 * - Files flat in `_tmp/` are aged by their own mtime.
 * - `_tmp/chat/<batch>/` (one directory per chat message,
 *   `webapp/routes/chat-uploads.ts`) and every other directory an agent or
 *   tool made in `_tmp/` are aged by their newest file and removed whole, so
 *   a scratch directory still in use keeps all its files.
 * - `_tmp/browser/` files are aged one by one.
 * - `OWNED_TMP_DIRS` are left alone.
 */
export async function cleanupOldTmpUploads(
  boxRoot: string,
  onLog?: (msg: string) => void,
): Promise<number> {
  const EXPIRY_DAYS = 7;
  const now = Date.now(); // file times are real, so age them on the real clock
  const expiryMs = EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  const sweep: Sweep = {
    isStale: (mtimeMs) => now - mtimeMs > expiryMs,
    ageDays: (mtimeMs) => Math.floor((now - mtimeMs) / (24 * 60 * 60 * 1000)),
    boxRoot,
    onLog,
  };
  const tmpDir = boxTmpDir(boxRoot);
  const batchesDir = chatUploadBatchesDir(boxRoot);

  let removed = 0;
  for (const entry of await listEntries(tmpDir)) {
    const full = path.join(tmpDir, entry);
    const stat = await statOrNull(full);
    if (stat === null || OWNED_TMP_DIRS.has(entry)) continue;
    const found = { path: full, mtimeMs: stat.mtimeMs };
    if (stat.isFile()) removed += await removeIfStale(sweep, found);
    else if (!stat.isDirectory()) continue;
    else if (full === batchesDir) removed += await sweepWholeDirs(sweep, full);
    else if (PER_FILE_TMP_DIRS.has(entry)) removed += await sweepFiles(sweep, full);
    else removed += await removeDirIfStale(sweep, found);
  }

  if (removed > 0) {
    onLog?.(`  Removed ${String(removed)} stale item(s) from _tmp/`);
  }
  return removed;
}

/** Each directory under `dir`, removed whole once its newest file is stale. */
async function sweepWholeDirs(sweep: Sweep, dir: string): Promise<number> {
  let removed = 0;
  for (const entry of await listEntries(dir)) {
    const full = path.join(dir, entry);
    const stat = await statOrNull(full);
    if (stat === null || !stat.isDirectory()) continue;
    removed += await removeDirIfStale(sweep, { path: full, mtimeMs: stat.mtimeMs });
  }
  return removed;
}

/** Each file directly in `dir`, removed once it is stale. */
async function sweepFiles(sweep: Sweep, dir: string): Promise<number> {
  let removed = 0;
  for (const entry of await listEntries(dir)) {
    const full = path.join(dir, entry);
    const stat = await statOrNull(full);
    if (stat === null || !stat.isFile()) continue;
    removed += await removeIfStale(sweep, { path: full, mtimeMs: stat.mtimeMs });
  }
  return removed;
}

async function removeDirIfStale(sweep: Sweep, dir: Entry): Promise<number> {
  const newest = await newestMtime(dir.path, dir.mtimeMs);
  if (!sweep.isStale(newest)) return 0;
  return remove(sweep, { path: dir.path, mtimeMs: newest, isDir: true });
}

async function removeIfStale(sweep: Sweep, file: Entry): Promise<number> {
  if (!sweep.isStale(file.mtimeMs)) return 0;
  return remove(sweep, file);
}

/** Remove the entry and log it. */
async function remove(sweep: Sweep, entry: Entry): Promise<number> {
  const label = `${path.relative(sweep.boxRoot, entry.path)}${entry.isDir === true ? "/" : ""}`;
  try {
    await fs.rm(entry.path, { recursive: true, force: true });
    sweep.onLog?.(`  Removed: ${label} (${String(sweep.ageDays(entry.mtimeMs))} days old)`);
    return 1;
  } catch (err) {
    sweep.onLog?.(`  Warning: could not remove ${label}: ${errorMessage(err)}`);
    return 0;
  }
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
 * The newest mtime among a directory's files, at any depth, or the
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
