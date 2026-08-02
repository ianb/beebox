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
 * one, never a half of either. This is the async counterpart of the pattern
 * `core/mobile/pairing.ts` (`writeDeviceStore`) established with sync fs.
 *
 * Use it for small state/credential files that are replaced wholesale. It is
 * NOT for append-heavy logs or for files large enough that a full temp copy
 * matters.
 */

import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "./error-guards.js";

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
    const code = errnoCode(e);
    if (code !== "EISDIR" && code !== "EPERM" && code !== "EINVAL" && code !== "ENOTSUP") {
      console.warn(`[atomic-write] failed to fsync directory ${dir}:`, e);
    }
  } finally {
    await handle?.close();
  }
}

export interface AtomicWriteOptions {
  /** Exact bytes the file should hold afterwards (including any trailing newline). */
  content: string;
  /** Mode for the temp file, inherited by the target through the rename.
   *  Omit to preserve an existing target's mode (platform default for a new
   *  file); pass 0o600 for anything credential-bearing. */
  mode?: number;
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
 * directory if needed. On any failure the temp sibling is cleaned up and the
 * original error is rethrown, so the target is left exactly as it was.
 */
export async function writeFileAtomic(filePath: string, opts: AtomicWriteOptions): Promise<void> {
  const { content, mode } = opts;
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${filePath}.tmp-${String(process.pid)}-${randomBytes(6).toString("hex")}`;
  try {
    const handle = await fs.open(tmp, "wx", await effectiveMode(filePath, mode));
    try {
      await handle.writeFile(content, "utf-8");
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
