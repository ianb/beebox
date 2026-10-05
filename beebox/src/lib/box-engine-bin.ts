/**
 * The `bbx` of the engine a box depends on: `<boxRoot>/node_modules/beebox`
 * resolved to its real path, plus `bin/bbx`. That is the worktree's checkout
 * for a managed worktree's box clone, the main checkout for a main-linked dev
 * box, and the installed package on the server. Shared by the hub supervisor
 * (which engine serves the box) and the validation-hook installer (which
 * engine validates its commits), so both use the same engine.
 */

import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../shared/error-guards.js";
import { fileExists } from "./file-exists.js";
import { PACKAGE_ROOT } from "./package-root.js";

/** Returns null when the box has no installed engine (`node_modules/beebox`
 *  absent, as before `pnpm install`) or the engine has no `bin/bbx`. */
export async function resolveBoxEngineBbx(boxRoot: string): Promise<string | null> {
  let engineRoot: string;
  try {
    engineRoot = await fs.realpath(path.join(boxRoot, "node_modules", "beebox"));
  } catch (e) {
    // Absent, or a dangling link (the linked checkout was deleted): the box
    // has no usable engine of its own.
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
  const bin = path.join(engineRoot, "bin", "bbx");
  return (await fileExists(bin)) ? bin : null;
}

/** This checkout's `bbx`, rebased onto the main checkout when this is a
 *  linked git worktree (worktrees are deleted on session exit, so a path
 *  stamped from one goes stale). Falls back to this checkout's own path when
 *  git isn't available. */
export function resolveStableCheckoutBbx(): string {
  const local = path.join(PACKAGE_ROOT, "bin", "bbx");
  try {
    // stdio: pipe the failure-case stderr instead of letting execFileSync's
    // default inherit it straight to our own stderr — a released package
    // (no shipped `.git`) hits this catch on every `bbx engine init`/hook install,
    // and "not a git repository" leaking out unprompted for something we
    // already handle gracefully is exactly the noise the monorepo's "quiet
    // on success" rule bans.
    const opts = {
      cwd: PACKAGE_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    } satisfies ExecFileSyncOptionsWithStringEncoding;
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], opts).trim();
    const commonDir = execFileSync(
      "git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], opts,
    ).trim();
    const mainTop = path.dirname(commonDir); // main worktree root (== `top` unless we're in a linked worktree)
    if (top !== "" && mainTop !== "" && mainTop !== top) {
      // In a linked worktree — rebase PACKAGE_ROOT's repo-relative path onto the main checkout.
      return path.join(mainTop, path.relative(top, PACKAGE_ROOT), "bin", "bbx");
    }
  } catch (_e) {
    // Not a git repo / git missing — the local checkout path is the best we have.
  }
  return local;
}
