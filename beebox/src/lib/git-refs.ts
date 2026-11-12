/**
 * Branch and tag operations.
 *
 * Split out of `git.ts` for its line budget. They are a cohesive set with one
 * caller each (`scenario/runner.ts` drives branches + tags for fixture replay,
 * `field-test/checkpoints.ts` tags baselines) and no overlap with the
 * stage/commit path that is the rest of `git.ts`.
 */

import { boxGit } from "./git/env.js";
import { withBoxGitLock } from "./git-lock.js";

/**
 * Get the current branch name.
 */
export async function getCurrentBranch(boxRoot: string): Promise<string> {
  const branch = await boxGit(boxRoot).branch();
  return branch.current;
}

/**
 * Create and switch to a new branch.
 */
export async function createBranch(boxRoot: string, name: string): Promise<void> {
  // `checkout` rewrites the index and the working tree, so it contends with
  // every commit — locked like the other index mutators.
  await withBoxGitLock(boxRoot, () => boxGit(boxRoot).checkoutLocalBranch(name));
}

/**
 * Switch to an existing branch.
 */
export async function checkoutBranch(boxRoot: string, name: string): Promise<void> {
  await withBoxGitLock(boxRoot, () => boxGit(boxRoot).checkout(name));
}

/**
 * Create a lightweight tag.
 */
export async function createTag(boxRoot: string, name: string): Promise<void> {
  await boxGit(boxRoot).tag([name]);
}

/**
 * Delete a tag.
 */
export async function deleteTag(boxRoot: string, name: string): Promise<void> {
  await boxGit(boxRoot).tag(["-d", name]);
}
