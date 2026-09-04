/**
 * "Is this box on git-annex?" — the cheap, binary-free probe.
 *
 * `bbx doctor annex` and `bbx attachments to-annex` ask this question through
 * {@link GitAnnexService.isInitialized}, which shells out to `git annex info`.
 * That is the right call there: both are user-invoked, both need the binary
 * anyway, and both want git-annex's own opinion. It is the wrong call for a
 * *gate* — something consulted at route registration and at the top of every
 * scan promote pass, on a box that may not have git-annex installed at all.
 * So this module answers from the filesystem: `git annex init` creates
 * `annex/` inside the repository's git directory, and nothing else does. (That
 * git directory is `<root>/.git` for an ordinary clone, and somewhere else
 * entirely for a linked worktree or submodule — see {@link gitDirsOf}.)
 *
 * ## Two conditions, not one
 *
 * A box is annex-shaped only when the annex is initialized AND its `.gitignore`
 * has stopped ignoring assets. Both halves are load-bearing, and the second one
 * is the half that actually broke: `bbx init` used to rewrite the box
 * `.gitignore` with the manifest-scheme asset block, silently reverting the
 * migration's un-ignore while `.git/annex/` sat there looking healthy. On such
 * a box `git add` never sees an asset, so nothing reaches the annex and every
 * asset-writing command fails at commit time — which is exactly the state the
 * scan pipeline must refuse to accept uploads into. (`bbx init` no longer does
 * this — see `core/box/index.ts` — but a box de-annexed by an older build, or
 * by hand, still has to be detected rather than trusted.)
 *
 * This deliberately does NOT try to decide whether the bytes are *healthy* —
 * that is `bbx doctor annex`'s job, it costs subprocesses, and a gate that
 * refuses work over a repairable condition is worse than one that lets the
 * repair happen.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getBoxShape } from "../../lib/box-shape.js";
import { gitignoreIgnoresAssets } from "../commands/attachments-gitignore.js";
import { errnoCode } from "../../lib/error-guards.js";

/** Read a `gitdir:`/`commondir` pointer file, or null when it isn't there or
 *  doesn't carry a path. Both are plain one-line text files git writes. */
async function readPointer(filePath: string, prefix: string): Promise<string | null> {
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT" || errnoCode(e) === "EISDIR") return null;
    throw e;
  }
  const line = text.split("\n")[0]?.trim();
  if (line === undefined || line === "") return null;
  if (prefix === "") return line;
  if (!line.startsWith(prefix)) return null;
  const value = line.slice(prefix.length).trim();
  return value === "" ? null : value;
}

/**
 * Where a repository's git directory (or directories) live, as absolute paths.
 *
 * Usually one: `<repoRoot>/.git`. A **linked worktree** or a submodule has a
 * `.git` FILE holding `gitdir: <path>` instead, and a linked worktree's own git
 * dir is per-worktree — git-annex's `annex/` lives under the COMMON dir, named
 * by a `commondir` file beside it. Both are checked, because a box clone made
 * as a linked worktree is a real annex box and treating it as un-annexed would
 * make `bbx init` de-annex it.
 *
 * Cheap filesystem reads only — no `git rev-parse` subprocess, since this is a
 * gate consulted at route registration and on every promote pass.
 */
async function gitDirsOf(repoRoot: string): Promise<string[]> {
  const dotGit = path.join(repoRoot, ".git");
  let stat;
  try {
    stat = await fs.stat(dotGit);
  } catch (e) {
    if (errnoCode(e) === "ENOENT" || errnoCode(e) === "ENOTDIR") return [];
    throw e;
  }
  if (stat.isDirectory()) return [dotGit];
  if (!stat.isFile()) return [];

  const pointer = await readPointer(dotGit, "gitdir:");
  if (pointer === null) return [];
  const gitDir = path.resolve(repoRoot, pointer);
  const common = await readPointer(path.join(gitDir, "commondir"), "");
  return common === null ? [gitDir] : [gitDir, path.resolve(gitDir, common)];
}

/**
 * Has `git annex init` run in this repository?
 *
 * Tests for `<gitdir>/annex/`, the directory git-annex creates on init and
 * keeps for the life of the repository (objects, journal, location log).
 * Repo-level and independent of the box's `.gitignore`, which is what makes it
 * safe for `bbx init` to branch on: the file `bbx init` writes can never change
 * the answer, so the decision cannot oscillate.
 *
 * @param repoRoot - The git repository root (the package root for a v2 box)
 */
export async function isAnnexInitialized(repoRoot: string): Promise<boolean> {
  for (const gitDir of await gitDirsOf(repoRoot)) {
    try {
      const stat = await fs.stat(path.join(gitDir, "annex"));
      if (stat.isDirectory()) return true;
    } catch (e) {
      // ENOENT/ENOTDIR are the normal "not on annex" answers for this candidate;
      // a linked worktree's own git dir legitimately has no `annex/` (the common
      // dir does), so keep looking rather than concluding anything here.
      if (errnoCode(e) === "ENOENT" || errnoCode(e) === "ENOTDIR") continue;
      throw e;
    }
  }
  return false;
}

/**
 * Is this box fully converted to git-annex — annex-initialized, with assets
 * visible to `git add`?
 *
 * Callers use this as a gate: a `false` means asset bytes written into the box
 * would be tracked by nothing and fail at commit, so the honest response is to
 * refuse the work rather than accept it and lose it.
 *
 * @param boxRoot - The box root
 */
export async function isAnnexBox(boxRoot: string): Promise<boolean> {
  const shape = await getBoxShape(boxRoot);
  if (!(await isAnnexInitialized(shape.boxRoot))) return false;
  return !(await gitignoreIgnoresAssets(boxRoot));
}
