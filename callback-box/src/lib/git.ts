/**
 * Git operations for callback box.
 *
 * Git is the state engine - a change hasn't "happened" until it's committed.
 *
 * The log-history/facet sub-feature lives in `git-log.ts`, trailer parsing +
 * the trailer-key vocabulary in `git-trailers.ts`, and shared error/retry
 * internals in `git-internal.ts`. This file re-exports the public surface of
 * those siblings so callers keep importing everything from "lib/git".
 *
 * ## Every index mutation runs under the box git lock
 *
 * A repository's index is one repo-wide mutex, so the mutators below wrap
 * themselves in `withBoxGitLock` (`git-lock.ts`) and our writers queue instead
 * of racing. The lock is reentrant, so a span that holds it — most importantly
 * `stageAndCommitPaths`, whose check-then-stage-then-commit is only atomic as a
 * whole — passes straight through the inner calls.
 *
 * Readers (`getStatus`, `getLog`, `getDiff`, `stagedPaths`, `pathsHaveChanges`,
 * `getHead`, ...) are deliberately NOT locked: serializing them would serialize
 * the whole system for no correctness gain. A reader that must sit inside a
 * span gets the lock from its caller — `withBoxGitLock` is exported for exactly
 * the multi-operation call sites (`getStatus` → `stageAll` → `commit`) that
 * need one.
 */

import { simpleGit, CleanOptions } from "simple-git";

import {
  GitCommandError,
  NoPathsError,
  GitIndexLockError,
  isIndexLockError,
  isNothingToCommitError,
  CommitDidNotLandError,
  unstageOversizedBlobs,
  LOG_FORMAT,
} from "./git-internal.js";
import { withBoxGitLock } from "./git-lock.js";
import { inspectIndexLock, recoverStaleIndexLock } from "./git-stale-lock.js";
import { sleep } from "./sleep.js";
import { errorMessage } from "./error-guards.js";
import type { GitLogFormat } from "./git-internal.js";
import { parseTrailers } from "./git-trailers.js";

export {
  CONNECTOR_TRAILER_KEYS,
  TOUCHPOINT_TRAILER_KEYS,
  FEEDBACK_TRAILER_KEYS,
} from "./git-trailers.js";
export { isNothingToCommitError, isContendedFailure, isStaleLockFailure } from "./git-internal.js";
export { withBoxGitLock } from "./git-lock.js";
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
 * The box's path within its git repository — POSIX-style, with a trailing
 * slash (e.g. `"content/"`), or `""` when the box root IS the repo root.
 *
 * A shapeVersion-2 box's git repo lives at the PACKAGE root, one level above
 * the operational box root (`content/`); a legacy box's git root coincides
 * with the box root. Git porcelain/`ls-tree`/`diff` output is repo-root-
 * relative, so box-relative code that compares against its own box-relative
 * paths (view gitStatus, maps delta detection, the oversized-blob guard)
 * must account for this prefix. `git rev-parse --show-prefix` reports exactly
 * it (empty from the repo root).
 */
export async function gitBoxPrefix(boxRoot: string): Promise<string> {
  return (await simpleGit(boxRoot).revparse(["--show-prefix"])).trim();
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
 * Run a git index mutation, retrying it once after a pause on an index.lock
 * contention error — git-lfs post-commit hooks and filter-process operations
 * overlap the next git call in boxes that track images/audio via LFS. Any other
 * failure is wrapped as a {@link GitCommandError}. The single home for the
 * retry idiom every index mutator here shares.
 *
 * Between the two attempts it also tries to RECOVER the lock. Hitting
 * `.git/index.lock` is the one moment we know for certain the file exists, so
 * it is the natural place to ask whether anything actually holds it; a lock a
 * killed git abandoned would otherwise fail every writer forever
 * (`git-stale-lock.ts` explains the test and why it is safe). The recovery
 * doubles as the pause the retry already wanted, so the contended path is no
 * slower than before.
 */
async function withIndexLockRetry<T>(dir: string, op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    if (!isIndexLockError(err)) throw new GitCommandError(err);
    const recovery = await recoverStaleIndexLock(dir);
    // `stale` means the file was abandoned AND removed, so the retry should
    // now succeed. Every other state left the lock in place; give a live
    // holder the pause it needs to finish.
    if (recovery.state !== "stale") await sleep(2000);
    try {
      return await op();
    } catch (retryErr) {
      if (!isIndexLockError(retryErr)) throw new GitCommandError(retryErr);
      // Still on the lock. Which failure this is decides whether anyone should
      // wait: an abandoned lock never clears, contention does. `unknown-holder`
      // reports as stale — we know it is old and un-clearing, and only the
      // holder probe was inconclusive; naming the file is the useful thing to
      // say either way.
      const after = await inspectIndexLock(dir);
      const abandoned = after.state === "stale" || after.state === "unknown-holder";
      throw new GitIndexLockError(retryErr, abandoned ? (after.lockPath ?? undefined) : undefined);
    }
  }
}

/**
 * Run an index mutation that creates a commit, under the box git lock, and
 * return the resulting HEAD. HEAD is read INSIDE the lock: read outside it, a
 * queued writer's commit could land first and we would report its hash as ours.
 *
 * **HEAD is compared, not just read.** simple-git's `.commit()` does NOT reject
 * when a hook rejects the commit — it resolves with an empty result
 * (`commit: ""`), and this function would then return the PREVIOUS head as
 * though it were the new commit. Every caller reads that as success. Verified
 * against simple-git with a `pre-commit` hook that exits 1; boxes run hooks on
 * every commit, so this is the ordinary failure path, not an exotic one.
 */
async function commitAndReadHead(boxRoot: string, op: () => Promise<unknown>): Promise<string> {
  const head = async (): Promise<string | null> =>
    (await hasCommits(boxRoot)) ? (await simpleGit(boxRoot).revparse(["HEAD"])).trim() : null;
  return withBoxGitLock(boxRoot, async () => {
    const before = await head();
    await withIndexLockRetry(boxRoot, op);
    const after = await head();
    if (after === null || after === before) throw new CommitDidNotLandError(boxRoot);
    return after;
  });
}

/**
 * Stage files for commit.
 *
 * @param boxRoot - Repository root
 * @param paths - Files to stage (relative to boxRoot)
 */
export async function stageFiles(boxRoot: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await withBoxGitLock(boxRoot, () => withIndexLockRetry(boxRoot, () => simpleGit(boxRoot).add(paths)));
}

/**
 * Unstage the given paths (reset their index entries to HEAD), leaving the
 * working tree untouched. The inverse of {@link stageFiles} for a specific set
 * of paths — used to undo a partial stage when a scoped commit fails, so the
 * staged entries don't get swept into a later unrelated commit.
 *
 * @param boxRoot - Repository root
 * @param paths - Files to unstage (relative to boxRoot)
 */
export async function unstageFiles(boxRoot: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const reset = (): Promise<string> => simpleGit(boxRoot).raw(["reset", "--quiet", "--", ...paths]);
  await withBoxGitLock(boxRoot, () => withIndexLockRetry(boxRoot, reset));
}

/**
 * List which of the given paths actually have staged (index vs HEAD) changes,
 * as boxRoot-relative paths (`--relative` keeps the output in the caller's
 * frame even when boxRoot sits below the repo root, as in a v2 package box).
 *
 * Exists because `git add <dir>` silently stages nothing when the directory's
 * contents are all gitignored (post-annex boxes ignore capture staging media),
 * and a subsequent `git commit -- <dir>` then fails with "pathspec did not
 * match any file(s) known to git". Committing only what really staged makes
 * the stage→commit pair safe under ignore rules.
 *
 * @param boxRoot - Repository root
 * @param paths - Paths to inspect (relative to boxRoot)
 */
async function stagedPaths(boxRoot: string, paths: string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  // Disable rename pairing: a path-scoped commit needs both the deleted source
  // and added destination. With rename detection, `--name-only` reports only
  // the destination and leaves the source deletion staged after the commit.
  const output = await simpleGit(boxRoot).raw(["diff", "--cached", "--name-only", "--no-renames", "--relative", "--", ...paths]);
  return output.split("\n").filter((line) => line !== "");
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
  await withBoxGitLock(boxRoot, async () => {
    await withIndexLockRetry(boxRoot, () => simpleGit(boxRoot).raw(["add", "-A"]));
    await unstageOversizedBlobs(boxRoot);
  });
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
  return commitAndReadHead(boxRoot, () => git.commit(message, commitArgs));
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

  return commitAndReadHead(boxRoot, () => git.raw(commitArgs));
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
 * The commit is scoped to what actually STAGED, not the requested paths: when a
 * requested directory's contents are all gitignored (post-annex boxes ignore
 * capture staging media), `git add` stages nothing from it and a commit
 * pathspec naming it would fail with "pathspec did not match any file(s) known
 * to git" (the 2026-08-03 box-family capture wedge).
 *
 * Returns the new commit hash, or `null` when there was nothing to commit.
 */
export async function stageAndCommitPaths(
  boxRoot: string,
  options: GitPathCommitOptions,
): Promise<string | null> {
  const { paths } = options;
  return withBoxGitLock(boxRoot, async () => {
    // Fast path: the box's auto-sweep may already have committed these paths (an
    // empty path list also lands here — nothing to stage or commit).
    if (!(await pathsHaveChanges(boxRoot, paths))) return null;
    await stageFiles(boxRoot, paths);
    const staged = await stagedPaths(boxRoot, paths);
    if (staged.length === 0) return null;
    try {
      return await commitPaths(boxRoot, { ...options, paths: staged });
    } catch (err) {
      // Residual race: a sweep committed our paths between the check and here.
      // "nothing to commit" means the paths landed — success, not an error.
      if (isNothingToCommitError(err)) return null;
      throw err;
    }
  });
}

function buildCommitMessage(options: GitCommitOptions): string {
  const entries = Object.entries(options.trailers ?? {});
  if (entries.length === 0) return options.message;
  const trailers = entries.map(([key, value]) => `${key}: ${value}`).join("\n");
  return `${options.message}\n\n${trailers}`;
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
async function resetHard(boxRoot: string, sha: string): Promise<void> {
  await withBoxGitLock(boxRoot, () => simpleGit(boxRoot).raw(["reset", "--hard", sha]));
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
  await withBoxGitLock(boxRoot, () => simpleGit(boxRoot).clean(modes));
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
  // One span: a writer must not slip a commit between the reset and the clean.
  await withBoxGitLock(boxRoot, async () => {
    await resetHard(boxRoot, sha);
    await clean(boxRoot, { directories: true });
  });
}
