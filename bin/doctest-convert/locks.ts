/**
 * Lock files for the conversion driver: created exclusively, holding the
 * owner's pid and what it works on. A lock whose owner is gone is stale and
 * is taken over, so a killed driver does not block the next one.
 *
 * Accepted gap: two drivers that take over the same stale lock at the same
 * moment can both succeed. That needs a crashed driver and two dispatches
 * started together; an OS-level lock would close it.
 */

import { spawnSync } from "node:child_process";
import { closeSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { LockTimeoutError } from "./errors.ts";
import { REPO } from "./tools.ts";

const LockSchema = z.object({ pid: z.number(), files: z.array(z.string()) });
export type LockInfo = z.infer<typeof LockSchema>;

const WAIT_STEP_MS = 1000;
const WAIT_LIMIT_MS = 2 * 60 * 60 * 1000;

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

function isExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

/** The lock's owner and files, or null when it is absent or unreadable. */
export function readLock(path: string): LockInfo | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  try {
    const parsed = LockSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch (error) {
    // A lock being written by its owner reads as empty for a moment.
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

/** Create the lock, or take over a stale one. Returns false when a live owner holds it. */
export function tryLock(path: string, files: readonly string[]): boolean {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, "wx");
      try {
        writeSync(fd, JSON.stringify({ pid: process.pid, files }));
      } finally {
        closeSync(fd);
      }
      return true;
    } catch (error) {
      if (!isExists(error)) throw error;
      const owner = readLock(path);
      if (owner === null || isAlive(owner.pid)) return false;
      rmSync(path, { force: true });
    }
  }
  return false;
}

/** Hold the lock while `fn` runs, waiting for a live owner to finish. */
export function withLock<T>(path: string, fn: () => T): T {
  const wait = new Int32Array(new SharedArrayBuffer(4));
  const start = Date.now();
  while (!tryLock(path, [])) {
    if (Date.now() - start > WAIT_LIMIT_MS) throw new LockTimeoutError(path);
    Atomics.wait(wait, 0, 0, WAIT_STEP_MS);
  }
  try {
    return fn();
  } finally {
    rmSync(path, { force: true });
  }
}

/**
 * The checkout's state lock, in its git directory: every command that saves
 * state holds it, so a dispatch and a standalone verify do not overwrite
 * each other's entries.
 */
export function stateLockPath(): string {
  const r = spawnSync("git", ["rev-parse", "--git-path", "doctest-convert.lock"], { cwd: REPO, encoding: "utf8" });
  const path = r.stdout.trim();
  return isAbsolute(path) ? path : join(REPO, path);
}
