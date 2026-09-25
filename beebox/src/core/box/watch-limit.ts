/**
 * Which boxes' file watchers ran out of directory watches, for the
 * `box-watch-limit` health check. Kept for the watcher's lifetime: a watch the
 * watcher refused is never retried, so the degradation lasts until the watcher
 * is closed.
 */

/** A box whose watcher ran out of directory watches, and where it stopped. */
interface WatchLimitStatus {
  maxWatchedDirs: number;
  /** Box-relative directory at which new watches were refused. */
  belowPath: string;
}

const watchLimits = new Map<string, WatchLimitStatus>();

export function recordWatchLimit(boxRoot: string, status: WatchLimitStatus): void {
  watchLimits.set(boxRoot, status);
}

export function clearWatchLimit(boxRoot: string): void {
  watchLimits.delete(boxRoot);
}

/**
 * Whether this process's watcher for `boxRoot` hit its directory limit. Null
 * when it has not, and also when this process runs no watcher (the CLI).
 */
export function watchLimitStatus(boxRoot: string): WatchLimitStatus | null {
  return watchLimits.get(boxRoot) ?? null;
}
