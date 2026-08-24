/**
 * Health check for an abandoned `.git/index.lock`.
 *
 * A box-level check rather than a per-task failure string, because one stale
 * file is a property of the BOX: it fails the scheduler, the box agent's own
 * auto-commits, and any hand-run `git commit`, all identically. Reported only
 * per task, it hid for hours behind two unrelated-looking schedule failures
 * while the box looked broadly broken.
 *
 * The check never removes anything — `git-stale-lock.ts` does that on the
 * write path, where a caller is already handling a failure. Health reporting
 * is a read.
 */

import { formatAge, inspectIndexLock, INDEX_LOCK_STALE_MS } from "../../../lib/git-stale-lock.js";
import { getBoxShape } from "../../../lib/box-shape.js";
import type { HealthCheck } from "./health.js";

const NAME = "stale-git-index-lock";

/**
 * Report an index lock that is old enough to be abandoned.
 *
 * `error`, not `warning`: while it stands, nothing in the box can commit, so
 * every write the box makes is being lost. A `fresh` lock is ordinary
 * contention and reports as passing — a check that fired on any lock at all
 * would be noise on every busy box.
 */
export async function staleIndexLockCheck(boxRoot: string): Promise<HealthCheck> {
  // The repository is at the PACKAGE root; `boxRoot` is `content/` inside it
  // and has no `.git` of its own. Same resolution `git-writable` uses.
  const { packageRoot } = await getBoxShape(boxRoot);
  const status = await inspectIndexLock(packageRoot);
  const minutes = Math.round(INDEX_LOCK_STALE_MS / 60_000);

  if (status.state === "absent" || status.state === "fresh" || status.state === "held") {
    return {
      name: NAME,
      ok: true,
      message: "no abandoned .git/index.lock",
      severity: "error",
    };
  }

  const age = formatAge(status.ageMs);
  const holder =
    status.state === "unknown-holder"
      ? "and there is no usable way to check whether a git process holds it"
      : "and no git process holds it";
  return {
    name: NAME,
    ok: false,
    message:
      `${status.lockPath ?? ".git/index.lock"} has been in place for ${age} ${holder} — ` +
      "a git process was killed mid-write. Nothing in this box can commit until it is removed. " +
      "Confirm no git is running, then delete the file. " +
      `(Anything older than ${String(minutes)}m counts as abandoned.)`,
    severity: "error",
  };
}
