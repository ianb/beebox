/**
 * Crash-safe whole-file replacement.
 *
 * `fs.writeFile` truncates the target and then streams into it, so a crash (or
 * an OOM kill, which is how this became a real incident — 2026-08-01) partway
 * through leaves a TRUNCATED file where a complete one used to be. For a store
 * that is read back and rewritten, that torn file is worse than no file: the
 * next read either parses garbage or reads short, and the next write commits
 * the loss.
 *
 * {@link writeFileAtomic} is the fix every such store shares: write a temp
 * sibling, fsync it, atomically rename over the target, then fsync the
 * directory. A kill at any point leaves either the old complete file or the new
 * one, never a half of either. {@link writeFileAtomicSync} does the same for
 * callers that cannot await.
 *
 * Use it for small state/credential files that are replaced wholesale. It is
 * NOT for append-heavy logs or for files large enough that a full temp copy
 * matters.
 */

import { randomBytes } from "node:crypto";
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../shared/error-guards.js";

/** fsync a directory so a rename's new dir entry is durable across a crash.
 *  Platforms that can't fsync a directory handle surface a benign errno we
 *  swallow — the rename is still atomic; only cross-crash durability of the
 *  dir entry is weakened there. */
async function fsyncDir(dir: string): Promise<void> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(dir, "r");
    await handle.sync();
  } catch (e) {
    if (!benignDirFsyncError(e)) console.warn(`[atomic-write] failed to fsync directory ${dir}:`, e);
  } finally {
    await handle?.close();
  }
}

export interface AtomicWriteOptions {
  /** Exact bytes the file should hold afterwards (including any trailing
   *  newline); a string is written as UTF-8. */
  content: string | Uint8Array;
  /** Mode for the temp file, inherited by the target through the rename.
   *  Omit to preserve an existing target's mode (platform default for a new
   *  file); pass 0o600 for anything credential-bearing. */
  mode?: number;
  /** `false`: fail with ENOENT when the directory is gone instead of creating
   *  it, for a write that must not recreate a folder something else moved. */
  createDir?: boolean;
}

/** The mode to create the temp sibling with: the caller's explicit choice,
 *  else the existing target's (a rename replaces the inode, so an unchanged
 *  `fs.writeFile`-style call would otherwise silently loosen a 0600 store
 *  back to the umask default), else undefined for the platform default. */
async function effectiveMode(filePath: string, mode: number | undefined): Promise<number | undefined> {
  if (mode !== undefined) return mode;
  try {
    const { mode: existing } = await fs.stat(filePath);
    return existing & 0o777;
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`[atomic-write] could not stat ${filePath} to preserve its mode:`, e);
    }
    return undefined;
  }
}

/**
 * Replace `filePath` with `content`, atomically. Creates the containing
 * directory if needed, unless `createDir` is false. On any failure the temp sibling is cleaned up and the
 * original error is rethrown, so the target is left exactly as it was.
 */
export async function writeFileAtomic(filePath: string, opts: AtomicWriteOptions): Promise<void> {
  const { content, mode } = opts;
  const dir = path.dirname(filePath);
  if (opts.createDir !== false) await fs.mkdir(dir, { recursive: true });
  const tmp = `${filePath}.tmp-${String(process.pid)}-${randomBytes(6).toString("hex")}`;
  try {
    const fileMode = await effectiveMode(filePath, mode);
    const handle = await fs.open(tmp, "wx", fileMode);
    try {
      // open()'s mode is masked by the umask; set it exactly.
      if (fileMode !== undefined) await handle.chmod(fileMode);
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, filePath);
  } catch (e) {
    try {
      await fs.unlink(tmp);
    } catch (unlinkErr) {
      if (errnoCode(unlinkErr) !== "ENOENT") {
        console.warn(`[atomic-write] failed to clean up temp file ${tmp}:`, unlinkErr);
      }
    }
    throw e;
  }
  await fsyncDir(dir);
}

function benignDirFsyncError(e: unknown): boolean {
  const code = errnoCode(e);
  return code === "EISDIR" || code === "EPERM" || code === "EINVAL" || code === "ENOTSUP";
}

function fsyncDirSync(dir: string): void {
  let fd: number | undefined;
  try {
    fd = fsSync.openSync(dir, "r");
    fsSync.fsyncSync(fd);
  } catch (e) {
    if (!benignDirFsyncError(e)) console.warn(`[atomic-write] failed to fsync directory ${dir}:`, e);
  } finally {
    if (fd !== undefined) fsSync.closeSync(fd);
  }
}

function effectiveModeSync(filePath: string, mode: number | undefined): number | undefined {
  if (mode !== undefined) return mode;
  try {
    return fsSync.statSync(filePath).mode & 0o777;
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`[atomic-write] could not stat ${filePath} to preserve its mode:`, e);
    }
    return undefined;
  }
}

/**
 * {@link writeFileAtomic} for callers that cannot await (sync stores read and
 * written inside one critical section). Same steps and options.
 */
export function writeFileAtomicSync(filePath: string, opts: AtomicWriteOptions): void {
  const dir = path.dirname(filePath);
  if (opts.createDir !== false) fsSync.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp-${String(process.pid)}-${randomBytes(6).toString("hex")}`;
  const payload = typeof opts.content === "string" ? Buffer.from(opts.content, "utf-8") : opts.content;
  try {
    const fileMode = effectiveModeSync(filePath, opts.mode);
    const fd = fsSync.openSync(tmp, "wx", fileMode);
    try {
      if (fileMode !== undefined) fsSync.fchmodSync(fd, fileMode);
      // A single writeSync may write less than asked; loop until it all lands.
      let offset = 0;
      while (offset < payload.length) offset += fsSync.writeSync(fd, payload, offset, payload.length - offset);
      fsSync.fsyncSync(fd);
    } finally {
      fsSync.closeSync(fd);
    }
    fsSync.renameSync(tmp, filePath);
  } catch (e) {
    try {
      fsSync.unlinkSync(tmp);
    } catch (unlinkErr) {
      if (errnoCode(unlinkErr) !== "ENOENT") {
        console.warn(`[atomic-write] failed to clean up temp file ${tmp}:`, unlinkErr);
      }
    }
    throw e;
  }
  fsyncDirSync(dir);
}

