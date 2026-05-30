/**
 * Shared internals for the git operation modules.
 *
 * Leaf module: holds the typed error classes, the index.lock detection +
 * retry primitive, and the custom log format used across git.ts and
 * git-log.ts. Nothing here imports back from those files, so there is no
 * value-import cycle.
 */

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
