/**
 * Putting uncommitted job cards back as `HEAD` has them, for a writer whose
 * commit of its job paths failed.
 *
 * An uncommitted job card holds its items (the wakeup's step 4b counts every
 * job's refs as jobbed) while the scheduler pass's job check skips it as a
 * write in progress, so its items would wait for nothing. Put back, a new card
 * is gone and a changed or deleted one has its committed content, so the next
 * wakeup finds the work where it was and does it again.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { simpleGit } from "simple-git";
import { hasCommits, unstageFiles, withBoxGitLock } from "../lib/git/core/operations.js";
import { errorMessage } from "../shared/error-guards.js";

/**
 * The files under `relPaths` that HEAD tracks, box-relative; empty before the
 * first commit. `ls-tree` without `--full-name` names paths relative to the
 * working directory, which is the box root, so in a box nested in its repo
 * (a package box) the names are box-relative already.
 */
export async function committedPaths(boxRoot: string, relPaths: string[]): Promise<string[]> {
  if (!(await hasCommits(boxRoot))) return [];
  const listed = await simpleGit(boxRoot).raw(["ls-tree", "-r", "--name-only", "HEAD", "--", ...relPaths]);
  return listed.split("\n").filter((line) => line !== "");
}

/**
 * Restore `jobs` (box-relative) to `HEAD`: a tracked path is checked out (a
 * changed card loses the change, a deleted one comes back), an untracked one
 * is unstaged and removed. Never throws: a failure is logged with `label`.
 */
export async function restoreJobsToHead(boxRoot: string, { jobs, label }: { jobs: string[]; label: string }): Promise<void> {
  try {
    await withBoxGitLock(boxRoot, async () => {
      const tracked = await committedPaths(boxRoot, jobs);
      const added = jobs.filter((job) => !tracked.includes(job));
      if (tracked.length > 0) await simpleGit(boxRoot).raw(["checkout", "HEAD", "--", ...tracked]);
      if (added.length > 0 && (await hasCommits(boxRoot))) await unstageFiles(boxRoot, added);
      for (const job of added) await fs.rm(path.join(boxRoot, job), { force: true });
    });
  } catch (error) {
    console.error(`[${label}] Could not restore uncommitted job cards ${jobs.join(", ")}; their items wait until a commit takes them: ${errorMessage(error)}`);
  }
}
