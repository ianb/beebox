import * as fs from "node:fs/promises";
import { errnoCode } from "../shared/error-guards.js";

/**
 * Existence probe: true if `absPath` is accessible, false otherwise. Shared by
 * the box-config loader, the maps precheck/finalize passes, and the markdown
 * link-repair rules, which each kept an identical private copy.
 */
export async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch (_e) {
    // access() throwing IS the answer: the path is absent or unreadable, which
    // for an existence probe both mean "not there" — no information to log.
    return false;
  }
}

/**
 * Strict existence probe: false only when the path is missing (ENOENT); any
 * other failure (permission, I/O) throws. For destructive or deciding checks
 * where an unreadable path must not pass as absent. `followLinks: false` uses
 * `lstat`, so a broken symlink counts as present.
 */
export async function pathExistsStrict(absPath: string, opts: { followLinks: boolean }): Promise<boolean> {
  try {
    await (opts.followLinks ? fs.stat(absPath) : fs.lstat(absPath));
    return true;
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return false;
    throw e;
  }
}
