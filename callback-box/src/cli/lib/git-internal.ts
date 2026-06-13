/**
 * Shared internals for the git operation modules.
 *
 * Leaf module: holds the typed error classes, the index.lock detection +
 * retry primitive, and the custom log format used across git.ts and
 * git-log.ts. Nothing here imports back from those files, so there is no
 * value-import cycle.
 */

import { simpleGit } from "simple-git";

/**
 * A git command failed with an error we don't specifically handle (i.e. not an
 * index.lock collision). Wraps the underlying cause so callers get a typed,
 * programmatically-distinguishable error while the original message is
 * preserved.
 */
export class GitCommandError extends Error {
  readonly cause: unknown;
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "GitCommandError";
    this.cause = cause;
  }
}

/**
 * A git operation was called with no paths where at least one is required.
 */
export class NoPathsError extends Error {
  constructor() {
    super("commitPaths requires at least one path");
    this.name = "NoPathsError";
  }
}

/**
 * Check if a git error is an index.lock collision. These happen when LFS
 * post-commit hooks or filter-process operations overlap with the next
 * git command — common when boxes track large binary files via LFS.
 */
export function isIndexLockError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("index.lock");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A housekeeping `git add -A` must never sweep a large blob into the box
 * repo. The limit is on the STAGED object size (git's actual cost), not
 * disk size — so git-lfs media (committed as ~130-byte pointers) always
 * passes regardless of how big the file is, while a big regular file is
 * caught. Files over the limit are left unstaged for a human/agent to
 * handle deliberately (LFS-track it, gitignore it, or remove it).
 */
const MAX_AUTO_STAGE_BYTES = 10 * 1024 * 1024;

/**
 * After a blind `add -A`, unstage any staged file whose object exceeds
 * MAX_AUTO_STAGE_BYTES. Best-effort: a failure in the size check must never
 * break the commit, so it logs and proceeds with whatever is staged.
 */
export async function unstageOversizedBlobs(boxRoot: string): Promise<void> {
  try {
    const git = simpleGit(boxRoot);
    const out = await git.raw(["diff", "--cached", "--name-only", "-z"]);
    const paths = out.split("\0").filter((p) => p.length > 0);
    const oversized: Array<{ path: string; bytes: number }> = [];
    for (const path of paths) {
      // `:path` is the staged (index) blob — a tiny pointer for LFS files.
      // Missing for staged deletions; those throw and are skipped (a
      // deletion isn't "adding a big file").
      try {
        const bytes = Number.parseInt((await git.raw(["cat-file", "-s", `:${path}`])).trim(), 10);
        if (Number.isFinite(bytes) && bytes > MAX_AUTO_STAGE_BYTES) {
          oversized.push({ path, bytes });
        }
      } catch (_e) {
        continue;
      }
    }
    if (oversized.length > 0) {
      await git.raw(["restore", "--staged", "--", ...oversized.map((o) => o.path)]);
      const mb = (MAX_AUTO_STAGE_BYTES / (1024 * 1024)).toFixed(0);
      const list = oversized
        .map((o) => `${o.path} (${(o.bytes / (1024 * 1024)).toFixed(1)}MB)`)
        .join(", ");
      console.warn(
        `[git] Housekeeping skipped staging ${oversized.length} file(s) over ${mb}MB (left uncommitted — LFS-track, gitignore, or remove): ${list}`,
      );
    }
  } catch (err) {
    console.warn(`[git] Oversized-blob guard failed (proceeding): ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Shape of our custom git log format. */
export interface GitLogFormat {
  hash: string;
  date: string;
  subject: string;
  body: string;
}

export const LOG_FORMAT: GitLogFormat = {
  hash: "%H",
  date: "%aI",
  subject: "%s",
  body: "%b",
};
