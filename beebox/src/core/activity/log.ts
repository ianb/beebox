/**
 * The activity log: `.beebox/activity.jsonl`, gitignored and append-only, one
 * JSON line per action a person took in a view or figure. Rotation renames it
 * to `activity.1.jsonl` (30 days by the first line, or 8 MB); readers read
 * both. Modeled on the notification log (`core/notification/log.ts`).
 *
 * Only the server writes. `seq` is assigned and rotation done under one file
 * lock (`activity.lock`), and a batch goes out as a single `appendFile`.
 * `seq` increases across rotation: the next one is read from the last line of
 * the live file, or of the rotated one when the live file is gone or empty.
 */

import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { withFileLock } from "../../lib/file-lock.js";
import { getBoxTime, getBoxTimeISO } from "../../lib/time.js";
import { errnoCode } from "../../shared/error-guards.js";
import { activityLineSchema, serializeLine, validEntries, MAX_LINE_BYTES, type ActivityLine } from "./entry.js";

const ROTATE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const ROTATE_BYTES = 8 * 1024 * 1024;
const LOCK_WAIT_MS = 5000;

export function activityLogPath(boxRoot: string): string {
  return path.join(boxRoot, ".beebox", "activity.jsonl");
}

export function rotatedActivityLogPath(boxRoot: string): string {
  return path.join(boxRoot, ".beebox", "activity.1.jsonl");
}

export function activityLockPath(boxRoot: string): string {
  return path.join(boxRoot, ".beebox", "activity.lock");
}

/** Run `fn` holding the log's lock (sequence, rotation and cursors share it), waiting up to `waitMs` for it. */
export function withActivityLockWithin<T>(opts: { boxRoot: string; waitMs: number }, fn: () => Promise<T>): Promise<T> {
  return withFileLock({ lockPath: activityLockPath(opts.boxRoot), metadata: { purpose: "activity log" }, waitMs: opts.waitMs }, fn);
}

/** Run `fn` holding the log's lock (sequence, rotation and cursors share it). The lock is not re-entrant. */
export function withActivityLock<T>(boxRoot: string, fn: () => Promise<T>): Promise<T> {
  return withActivityLockWithin({ boxRoot, waitMs: LOCK_WAIT_MS }, fn);
}

async function readTail(filePath: string): Promise<string[] | null> {
  let handle: fsp.FileHandle;
  try {
    handle = await fsp.open(filePath, "r");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, MAX_LINE_BYTES * 3);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    return buffer.toString("utf-8").split("\n").filter((l) => l.trim() !== "");
  } finally {
    await handle.close();
  }
}

async function lastSeqIn(filePath: string): Promise<number | null> {
  const lines = await readTail(filePath);
  for (const text of (lines ?? []).toReversed()) {
    try {
      const parsed = activityLineSchema.safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data.seq;
    } catch (_e) {
      continue; // a torn first line of the tail window, or a corrupt line; try the one before
    }
  }
  return null;
}

/** The highest `seq` in the log, or 0 when it is empty. */
export async function lastActivitySeq(boxRoot: string): Promise<number> {
  return (await lastSeqIn(activityLogPath(boxRoot))) ?? (await lastSeqIn(rotatedActivityLogPath(boxRoot))) ?? 0;
}

async function firstLineAt(filePath: string): Promise<number | null> {
  const handle = await fsp.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(MAX_LINE_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, MAX_LINE_BYTES, 0);
    const first = buffer.subarray(0, bytesRead).toString("utf-8").split("\n")[0] ?? "";
    const parsed = activityLineSchema.safeParse(JSON.parse(first));
    return parsed.success ? Date.parse(parsed.data.at) : null;
  } catch (e) {
    console.warn(`[activity-log] could not read the first line of ${filePath}:`, e);
    return null;
  } finally {
    await handle.close();
  }
}

/** Rename the live file to `.1` when its first line is over 30 days old or it exceeds 8 MB. Call under the lock. */
async function rotateIfNeeded(boxRoot: string): Promise<boolean> {
  const logPath = activityLogPath(boxRoot);
  let size: number;
  try {
    size = (await fsp.stat(logPath)).size;
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return false;
    throw e;
  }
  if (size === 0) return false;
  const firstAt = size > ROTATE_BYTES ? null : await firstLineAt(logPath);
  const tooOld = firstAt !== null && getBoxTime(boxRoot).getTime() - firstAt > ROTATE_AGE_MS;
  if (size <= ROTATE_BYTES && !tooOld) return false;
  await fsp.rename(logPath, rotatedActivityLogPath(boxRoot));
  return true;
}

/**
 * Validate, stamp and append a batch in the order given. Invalid entries are
 * dropped with a warning; the rest are kept. Returns how many were written.
 */
export async function recordActivity(
  boxRoot: string,
  opts: { entries: readonly unknown[]; user: string | null },
): Promise<number> {
  const entries = validEntries(opts.entries);
  if (entries.length === 0) return 0;
  return withActivityLock(boxRoot, async () => {
    // Stamped under the lock, so an entry that waited behind a send is stamped after that send's `sentAt`.
    const at = getBoxTimeISO(boxRoot);
    let seq = await lastActivitySeq(boxRoot);
    const lines: string[] = [];
    for (const entry of entries) {
      const text = serializeLine({ ...entry, seq: seq + 1, at, user: opts.user });
      if (text === null) {
        console.warn(`[activity] dropped an entry for ${entry.card}: it does not fit one log line`);
        continue;
      }
      seq += 1;
      lines.push(text);
    }
    if (lines.length === 0) return 0;
    await rotateIfNeeded(boxRoot);
    await fsp.mkdir(path.dirname(activityLogPath(boxRoot)), { recursive: true });
    await fsp.appendFile(activityLogPath(boxRoot), lines.join(""));
    return lines.length;
  });
}

async function readLines(filePath: string): Promise<ActivityLine[]> {
  let raw: string;
  try {
    raw = await fsp.readFile(filePath, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return [];
    throw e;
  }
  const lines: ActivityLine[] = [];
  for (const text of raw.split("\n")) {
    if (text.trim() === "") continue;
    try {
      const parsed = activityLineSchema.safeParse(JSON.parse(text));
      if (parsed.success) lines.push(parsed.data);
      else console.warn(`[activity-log] skipping an invalid line in ${filePath}: ${parsed.error.message}`);
    } catch (e) {
      console.warn(`[activity-log] skipping an unparseable line in ${filePath}:`, e);
    }
  }
  return lines;
}

/**
 * Every line, oldest first: the rotated file, then the live one, read as one
 * snapshot under the lock so a rotation cannot move entries from the live
 * file into `.1` between the two reads. Callers already holding the lock use
 * `readActivityLocked`.
 */
export function readActivity(boxRoot: string): Promise<ActivityLine[]> {
  return withActivityLock(boxRoot, () => readActivityLocked(boxRoot));
}

/** `readActivity` for a caller that holds the activity lock. */
export async function readActivityLocked(boxRoot: string): Promise<ActivityLine[]> {
  const rotated = await readLines(rotatedActivityLogPath(boxRoot));
  const live = await readLines(activityLogPath(boxRoot));
  const bySeq = new Map<number, ActivityLine>();
  for (const line of [...rotated, ...live]) bySeq.set(line.seq, line);
  return [...bySeq.values()];
}
