/**
 * Git operations for callback box.
 *
 * Git is the state engine - a change hasn't "happened" until it's committed.
 *
 * The log-history/facet sub-feature lives in `git-log.ts`, trailer parsing +
 * the trailer-key vocabulary in `git-trailers.ts`, and shared error/retry
 * internals in `git-internal.ts`. This file re-exports the public surface of
 * those siblings so callers keep importing everything from "lib/git".
 */

import { simpleGit, CleanOptions } from "simple-git";

import {
  GitCommandError,
  NoPathsError,
  isIndexLockError,
  isNothingToCommitError,
  unstageOversizedBlobs,
  LOG_FORMAT,
} from "./git-internal.js";
import { sleep } from "./sleep.js";
import { errorMessage } from "./error-guards.js";
import type { GitLogFormat } from "./git-internal.js";
import { parseTrailers } from "./git-trailers.js";

export {
  CONNECTOR_TRAILER_KEYS,
  TOUCHPOINT_TRAILER_KEYS,
  FEEDBACK_TRAILER_KEYS,
} from "./git-trailers.js";
export { isNothingToCommitError } from "./git-internal.js";
export { getLogPaginated, getTrailerFacets } from "./git-log.js";
export type {
  FileStat,
  GitLogEntryExtended,
  GetLogPaginatedParams,
  LogFilter,
  TrailerFacets,
} from "./git-log.js";

export interface GitCommitOptions {
  message: string;
  trailers?: Record<string, string>;
  amend?: boolean;
  /**
   * Skip `pre-commit`/`commit-msg` hooks (`git commit --no-verify`). Default
   * false — an engine-driven commit SHOULD normally clear the same
   * card-validation gate a human commit does. The one deliberate exception
   * today is `box-packageify` (`scripts/migrate/box-packageify.ts`): its
   * commit both installs a fresh `.git/hooks/pre-commit` AND is the commit
   * that would trigger it, and the migration's own preconditions already
   * machine-verify the structural transform — see that script's doc
   * comment for the full rationale.
   */
  noVerify?: boolean;
}

export interface GitPathCommitOptions extends GitCommitOptions {
  paths: string[];
}

export interface GitLogEntry {
  hash: string;
  date: string;
  subject: string;
  body?: string | undefined;
  trailers?: Record<string, string> | undefined;
}

export interface GitStatus {
  staged: string[];
  modified: string[];
  untracked: string[];
  clean: boolean;
}

/**
 * Initialize a new git repository.
 *
 * @param boxRoot - Directory to initialize
 * @param initialBranch - Name of the initial branch (default: "main")
 */
export async function initRepo(
  boxRoot: string,
  initialBranch?: string
): Promise<void> {
  initialBranch = initialBranch ?? "main";
  await simpleGit(boxRoot).raw(["init", "-b", initialBranch]);
}

/**
 * Check if a directory is a git repository.
 */
export async function isRepo(dir: string): Promise<boolean> {
  try {
    return await simpleGit(dir).checkIsRepo();
  } catch (_e) {
    // checkIsRepo throws when dir is not a git repo — that's the answer we want.
    return false;
  }
}

/**
 * Get the status of the repository.
 */
export async function getStatus(boxRoot: string): Promise<GitStatus> {
  const status = await simpleGit(boxRoot).status();

  // simple-git separates modified and deleted; our GitStatus combines
  // all working-tree changes (modifications + deletions) into `modified`
  // to match the original porcelain parsing behavior.
  const modified = [...status.modified, ...status.deleted.filter((f) => !status.staged.includes(f))];

  return {
    staged: status.staged,
    modified,
    untracked: status.not_added,
    clean: status.isClean(),
  };
}

/**
 * Stage files for commit.
 *
 * @param boxRoot - Repository root
 * @param paths - Files to stage (relative to boxRoot)
 */
export async function stageFiles(boxRoot: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await simpleGit(boxRoot).add(paths);
  } catch (err) {
    if (isIndexLockError(err)) {
      await sleep(2000);
      await simpleGit(boxRoot).add(paths);
    } else {
      throw new GitCommandError(err);
    }
  }
}

/**
 * Check whether any of the given paths have tracked or untracked changes.
 *
 * @param boxRoot - Repository root
 * @param paths - Paths to inspect (relative to boxRoot)
 */
export async function pathsHaveChanges(boxRoot: string, paths: string[]): Promise<boolean> {
  if (paths.length === 0) return false;
  const output = await simpleGit(boxRoot).raw(["status", "--short", "--", ...paths]);
  return output.trim().length > 0;
}

/**
 * Stage all changes, then drop any oversized regular blob from the index
 * (see unstageOversizedBlobs) so a blind housekeeping sweep can't commit a
 * big file. Retries the add once on index.lock errors, which occur when
 * git-lfs post-commit hooks or filter-process operations overlap with the
 * next git operation — common in boxes that track images/audio via LFS.
 */
export async function stageAll(boxRoot: string): Promise<void> {
  try {
    await simpleGit(boxRoot).raw(["add", "-A"]);
  } catch (err) {
    if (isIndexLockError(err)) {
      await sleep(2000);
      await simpleGit(boxRoot).raw(["add", "-A"]);
    } else {
      throw new GitCommandError(err);
    }
  }
  await unstageOversizedBlobs(boxRoot);
}

/**
 * Create a commit with the given message and optional trailers.
 *
 * @param boxRoot - Repository root
 * @param options - Commit options
 * @returns The commit hash
 */
export async function commit(
  boxRoot: string,
  options: GitCommitOptions
): Promise<string> {
  const message = buildCommitMessage(options);

  const git = simpleGit(boxRoot);
  const commitArgs = options.amend ? ["--amend"] : [];
  if (options.noVerify) commitArgs.push("--no-verify");
  try {
    await git.commit(message, commitArgs);
  } catch (err) {
    if (isIndexLockError(err)) {
      await sleep(2000);
      await git.commit(message, commitArgs);
    } else {
      throw new GitCommandError(err);
    }
  }

  // Get the commit hash
  const hash = await git.revparse(["HEAD"]);
  return hash.trim();
}

/**
 * Commit only the given paths, ignoring unrelated staged changes.
 *
 * @param boxRoot - Repository root
 * @param paths - Paths to commit (relative to boxRoot)
 * @param options - Commit options
 * @returns The commit hash
 */
export async function commitPaths(
  boxRoot: string,
  options: GitPathCommitOptions,
): Promise<string> {
  const { paths } = options;
  if (paths.length === 0) {
    throw new NoPathsError();
  }

  const message = buildCommitMessage(options);
  const git = simpleGit(boxRoot);
  const commitArgs = ["commit", "-m", message];
  if (options.amend) {
    commitArgs.push("--amend");
  }
  commitArgs.push("--", ...paths);

  try {
    await git.raw(commitArgs);
  } catch (err) {
    if (isIndexLockError(err)) {
      await sleep(2000);
      await git.raw(commitArgs);
    } else {
      throw new GitCommandError(err);
    }
  }

  const hash = await git.revparse(["HEAD"]);
  return hash.trim();
}

/**
 * Stage `paths` and commit exactly them, tolerating a concurrent sweep that
 * may have already committed the same paths.
 *
 * The idiom this consolidates (from the clerk router): a `stageFiles` +
 * `commit` pair is two non-atomic ops on one shared git index, so scoping the
 * commit to `paths` (via `commitPaths`) is what keeps a concurrent mutator's
 * unrelated staged files from being co-committed under this caller's
 * attribution. Two races are absorbed rather than surfaced as errors:
 *
 *   - Fast path: if none of `paths` currently show changes, a sweep already
 *     committed them — nothing to do, return `null`.
 *   - Residual race: if the sweep commits between our `pathsHaveChanges` check
 *     and our `commitPaths`, git reports "nothing to commit"
 *     (`isNothingToCommitError`) — the paths landed anyway, so that is success,
 *     also `null`.
 *
 * Returns the new commit hash, or `null` when there was nothing to commit.
 */
export async function stageAndCommitPaths(
  boxRoot: string,
  options: GitPathCommitOptions,
): Promise<string | null> {
  const { paths } = options;
  // Fast path: the box's auto-sweep may already have committed these paths (an
  // empty path list also lands here — nothing to stage or commit).
  if (!(await pathsHaveChanges(boxRoot, paths))) return null;
  await stageFiles(boxRoot, paths);
  try {
    return await commitPaths(boxRoot, options);
  } catch (err) {
    // Residual race: a sweep committed our paths between the check and here.
    // "nothing to commit" means the paths landed — success, not an error.
    if (isNothingToCommitError(err)) return null;
    throw err;
  }
}

function buildCommitMessage(options: GitCommitOptions): string {
  let message = options.message;

  if (options.trailers && Object.keys(options.trailers).length > 0) {
    message += "\n";
    for (const [key, value] of Object.entries(options.trailers)) {
      message += `\n${key}: ${value}`;
    }
  }

  return message;
}

/**
 * Get recent commits from the log.
 *
 * @param boxRoot - Repository root
 * @param count - Number of commits to retrieve
 * @returns Array of log entries
 */
export async function getLog(
  boxRoot: string,
  count?: number
): Promise<GitLogEntry[]> {
  count = count ?? 10;
  if (count === 0) return [];

  try {
    const result = await simpleGit(boxRoot).log<GitLogFormat>({
      maxCount: count,
      format: LOG_FORMAT,
    });

    return result.all.map((entry) => {
      const body = entry.body.trim() || undefined;
      const trailers = parseTrailers(body);

      return {
        hash: entry.hash,
        date: entry.date,
        subject: entry.subject,
        body,
        trailers: Object.keys(trailers).length > 0 ? trailers : undefined,
      };
    });
  } catch (_e) {
    // log() throws on a repo with no commits yet — an empty history is the
    // expected, non-error result here.
    return [];
  }
}

/**
 * Get the diff of uncommitted changes.
 *
 * @param boxRoot - Repository root
 * @param staged - If true, show staged changes; if false, show unstaged
 * @returns The diff output
 */
export async function getDiff(
  boxRoot: string,
  staged?: boolean
): Promise<string> {
  staged = staged ?? false;
  const args = staged ? ["--cached"] : [];
  return simpleGit(boxRoot).diff(args);
}

/**
 * Get the current branch name.
 */
export async function getCurrentBranch(boxRoot: string): Promise<string> {
  const branch = await simpleGit(boxRoot).branch();
  return branch.current;
}

/**
 * Check if there are any commits in the repository.
 */
export async function hasCommits(boxRoot: string): Promise<boolean> {
  try {
    await simpleGit(boxRoot).revparse(["HEAD"]);
    return true;
  } catch (_e) {
    // revparse HEAD fails when there are no commits yet — that means false.
    return false;
  }
}

/**
 * Result of a pushToRemote attempt. Designed to carry all information a
 * caller needs to log without re-throwing — push is expected to fail
 * intermittently (network, auth, upstream race) and callers should treat
 * errors as non-fatal.
 */
export interface PushResult {
  /** True when nothing was attempted (no remote, already up-to-date, no tracking). */
  skipped: boolean;
  /** Human-readable reason when skipped. */
  reason?: string;
  /** Number of commits that were pushed (0 when skipped). */
  commitsPushed: number;
  /** Error message when the push attempt itself failed. */
  error?: string;
}

/**
 * Push committed changes to the current branch's upstream, if configured
 * and ahead. Returns a structured result rather than throwing, so wakeup
 * and tick callers can log the outcome without blowing up the cycle.
 */
export async function pushToRemote(boxRoot: string): Promise<PushResult> {
  const git = simpleGit(boxRoot);

  const remotes = await git.getRemotes();
  if (remotes.length === 0) {
    return { skipped: true, reason: "no remote configured", commitsPushed: 0 };
  }

  const status = await git.status();
  if (!status.tracking) {
    return { skipped: true, reason: "no upstream tracking branch", commitsPushed: 0 };
  }
  if (status.ahead === 0) {
    return { skipped: true, reason: "already up to date", commitsPushed: 0 };
  }

  try {
    await git.push();
    return { skipped: false, commitsPushed: status.ahead };
  } catch (err) {
    return { skipped: false, commitsPushed: 0, error: errorMessage(err) };
  }
}

/**
 * Create and switch to a new branch.
 */
export async function createBranch(boxRoot: string, name: string): Promise<void> {
  await simpleGit(boxRoot).checkoutLocalBranch(name);
}

/**
 * Switch to an existing branch.
 */
export async function checkoutBranch(boxRoot: string, name: string): Promise<void> {
  await simpleGit(boxRoot).checkout(name);
}

/**
 * Create a lightweight tag.
 */
export async function createTag(boxRoot: string, name: string): Promise<void> {
  await simpleGit(boxRoot).tag([name]);
}

/**
 * Delete a tag.
 */
export async function deleteTag(boxRoot: string, name: string): Promise<void> {
  await simpleGit(boxRoot).tag(["-d", name]);
}

/**
 * Get the diff for a specific commit.
 *
 * @param boxRoot - Repository root
 * @param hash - Commit hash
 * @returns The diff output
 */
export async function getCommitDiff(
  boxRoot: string,
  hash: string
): Promise<string> {
  const git = simpleGit(boxRoot);
  try {
    // Try normal diff against parent, with low rename threshold
    return await git.diff(["-M10", `${hash}~1`, hash]);
  } catch (_e) {
    // Diff against parent fails for the initial commit (no `${hash}~1`).
    // Fall back to `show`, which renders the initial commit's contents.
    try {
      return await git.raw(["show", "-M10", "--format=", hash]);
    } catch (e) {
      // Even `show` failed — likely a bad/unknown hash. Surface it and
      // fall back to an empty diff so the caller still renders.
      console.warn(`Failed to get diff for commit ${hash}; returning empty diff:`, e);
      return "";
    }
  }
}

/**
 * Get the current HEAD commit hash.
 */
export async function getHead(boxRoot: string): Promise<string> {
  const hash = await simpleGit(boxRoot).revparse(["HEAD"]);
  return hash.trim();
}

/**
 * Hard-reset the working tree to `sha`, discarding all commits and working-tree
 * changes made since. Used by `cb upgrade`'s revert-on-failure path (see
 * `src/cli/commands/upgrade.ts`) to undo a data migration and the dependency
 * bump TOGETHER as one unit — the Ghost-CLI lesson this whole design guards
 * against (`ghost update --rollback` used to revert only the code, leaving
 * migrated data behind). This is real data loss by design: only ever call it
 * against a `sha` captured before the changes being discarded.
 */
export async function resetHard(boxRoot: string, sha: string): Promise<void> {
  await simpleGit(boxRoot).raw(["reset", "--hard", sha]);
}

/**
 * Remove untracked files from the working tree.
 */
export async function clean(
  boxRoot: string,
  opts?: { gitignored?: boolean; directories?: boolean }
): Promise<void> {
  opts = opts ?? {};
  const modes: CleanOptions[] = [CleanOptions.FORCE];
  if (opts.gitignored) modes.push(CleanOptions.IGNORED_ONLY);
  if (opts.directories) modes.push(CleanOptions.RECURSIVE);
  await simpleGit(boxRoot).clean(modes);
}

/**
 * The shared "undo everything since the snapshot" primitive: `resetHard`
 * (discards tracked-file changes back to `sha`) followed by `clean` with
 * `directories: true` (removes untracked debris a failed step left behind —
 * safe only when the tree was verified clean immediately before the
 * snapshot, since then anything untracked found now was created by the
 * failed operation). Factored out of `cb upgrade`'s revert path
 * (`src/cli/commands/upgrade.ts`) so any OTHER all-or-nothing operation
 * (e.g. the `box-packageify` migration, which wraps a whole legacy→v2
 * conversion in this same guarantee) shares one implementation of the
 * Ghost-CLI lesson: code and data revert together, as one unit.
 */
export async function revertToSnapshot(boxRoot: string, sha: string): Promise<void> {
  await resetHard(boxRoot, sha);
  await clean(boxRoot, { directories: true });
}
