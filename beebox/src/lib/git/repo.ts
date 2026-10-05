/** Whether a directory is its own git repository, and which repository contains it. */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { simpleGit } from "simple-git";

/**
 * Whether `dir` is the root of its own repository, not merely inside one.
 */
export async function isRepo(dir: string): Promise<boolean> {
  const root = await repoRootOf(dir);
  return root !== null && root === (await realpathOrSelf(dir));
}

/**
 * The root of the git repository that contains `dir` (symlinks resolved), or
 * null when `dir` is missing or in no repository. A directory merely inside
 * another repository is not that repository: `bbx engine init` once treated a
 * box path under the monorepo as "already a repo", skipped `git init`, and
 * annex-initialized the monorepo instead.
 */
export async function repoRootOf(dir: string): Promise<string | null> {
  try {
    const top = (await simpleGit(dir).revparse(["--show-toplevel"])).trim();
    return await realpathOrSelf(top);
  } catch (_e) {
    // simple-git throws for a missing directory and git for "not a repository"; both mean no repository.
    return null;
  }
}

async function realpathOrSelf(dir: string): Promise<string> {
  try {
    return await fs.realpath(dir);
  } catch (_e) {
    // Not on disk yet: compare the path as given.
    return path.resolve(dir);
  }
}
