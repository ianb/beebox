/**
 * "Is this box on git-annex?" — the cheap, binary-free probe.
 *
 * `cb doctor annex` and `cb attachments to-annex` ask this question through
 * {@link GitAnnexService.isInitialized}, which shells out to `git annex info`.
 * That is the right call there: both are user-invoked, both need the binary
 * anyway, and both want git-annex's own opinion. It is the wrong call for a
 * *gate* — something consulted at route registration and at the top of every
 * scan promote pass, on a box that may not have git-annex installed at all.
 * So this module answers from the filesystem: `git annex init` creates
 * `.git/annex/`, and nothing else does.
 *
 * ## Two conditions, not one
 *
 * A box is annex-shaped only when the annex is initialized AND its `.gitignore`
 * has stopped ignoring assets. Both halves are load-bearing, and the second one
 * is the half that actually broke: `cb init` used to rewrite the box
 * `.gitignore` with the manifest-scheme asset block, silently reverting the
 * migration's un-ignore while `.git/annex/` sat there looking healthy. On such
 * a box `git add` never sees an asset, so nothing reaches the annex and every
 * asset-writing command fails at commit time — which is exactly the state the
 * scan pipeline must refuse to accept uploads into. (`cb init` no longer does
 * this — see `core/box/index.ts` — but a box de-annexed by an older build, or
 * by hand, still has to be detected rather than trusted.)
 *
 * This deliberately does NOT try to decide whether the bytes are *healthy* —
 * that is `cb doctor annex`'s job, it costs subprocesses, and a gate that
 * refuses work over a repairable condition is worse than one that lets the
 * repair happen.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getBoxShape } from "../../lib/box-shape.js";
import { isAssetIgnoreRule } from "../commands/attachments-gitignore.js";
import { errnoCode } from "../../lib/error-guards.js";

/**
 * Has `git annex init` run in this repository?
 *
 * Tests for `.git/annex/`, the directory git-annex creates on init and keeps
 * for the life of the repository (objects, journal, location log). Repo-level
 * and independent of the box's `.gitignore`, which is what makes it safe for
 * `cb init` to branch on: the file `cb init` writes can never change the
 * answer, so the decision cannot oscillate.
 *
 * @param repoRoot - The git repository root (the package root for a v2 box)
 */
export async function isAnnexInitialized(repoRoot: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(repoRoot, ".git", "annex"));
    return stat.isDirectory();
  } catch (e) {
    // ENOENT is the normal "not on annex" answer. ENOTDIR means `.git` is a
    // file (a linked worktree or submodule), which is likewise not a box we
    // can call annex-shaped from here.
    if (errnoCode(e) === "ENOENT" || errnoCode(e) === "ENOTDIR") return false;
    throw e;
  }
}

/** Does the box `.gitignore` still ignore asset binaries (the manifest scheme)? */
async function gitignoreIgnoresAssets(boxRoot: string): Promise<boolean> {
  let text: string;
  try {
    text = await fs.readFile(path.join(boxRoot, ".gitignore"), "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return false;
    throw e;
  }
  return text.split("\n").some((line) => isAssetIgnoreRule(line));
}

/**
 * Is this box fully converted to git-annex — annex-initialized, with assets
 * visible to `git add`?
 *
 * Callers use this as a gate: a `false` means asset bytes written into the box
 * would be tracked by nothing and fail at commit, so the honest response is to
 * refuse the work rather than accept it and lose it.
 *
 * @param boxRoot - The operational box root (`<packageRoot>/content`)
 */
export async function isAnnexBox(boxRoot: string): Promise<boolean> {
  const shape = await getBoxShape(boxRoot);
  if (!(await isAnnexInitialized(shape.packageRoot))) return false;
  return !(await gitignoreIgnoresAssets(boxRoot));
}
