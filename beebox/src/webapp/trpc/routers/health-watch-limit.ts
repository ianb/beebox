/**
 * The `box-watch-limit` check: a box with more directories than its file
 * watcher may watch, so live updates are off below some path.
 *
 * This replaced the box-growth level warning (250 directories / 1,000 files),
 * which fired on any box with an email connector and could never clear. The
 * watcher limit is the directory count that actually degrades something, and
 * the watcher itself knows when it was reached — the growth scan counts a
 * different tree (it keeps dot-directories the watcher skips), so it cannot
 * predict this.
 *
 * Only the server process runs a watcher; elsewhere (`bbx health`) the check
 * is absent rather than reporting a state it cannot see.
 */

import { watchLimitStatus } from "../../../core/box/watch-limit.js";
import type { HealthCheck } from "./health.js";

export function watchLimitHealthChecks(boxRoot: string): HealthCheck[] {
  const status = watchLimitStatus(boxRoot);
  if (status === null) return [];
  const where = status.belowPath === "" ? "the box" : status.belowPath;
  return [{
    name: "box-watch-limit",
    ok: false,
    message:
      `Live updates are off below ${where}: the box has more than `
      + `${status.maxWatchedDirs.toLocaleString("en-US")} watched directories.`,
    severity: "warning",
  }];
}
