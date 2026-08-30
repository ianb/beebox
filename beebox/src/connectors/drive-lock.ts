/**
 * The per-box Drive mirror lock — one writer at a time over the whole
 * mirror/sync span.
 *
 * ## Why a span lock rather than the state delta-merge alone
 *
 * `google-drive-state.ts` merges two writers' per-file state at the save point,
 * which keeps the state FILE consistent. It does not keep the two writers from
 * doing the same work: `bbx drive mount` from a chat agent can run while `bbx
 * wakeup`'s connector sync is mid-pass, and both can discover the same
 * newly-listed Drive child, both create its card, and both push a local edit
 * upstream. That is a race over the box and over Drive, not over a JSON file,
 * so it needs exclusion across the whole span — the connector's `sync()`,
 * `mirrorFolderOnce` / `syncFolderMount`, and `bbx drive add`'s pull.
 *
 * ## Lock ordering: this lock, THEN the box git lock. Never the reverse.
 *
 * A locked span commits what it mirrored, and `stageAndCommitPaths` takes
 * `withBoxGitLock` inside. That nesting is safe *because it only ever runs in
 * this direction*: nothing acquires the Drive mirror lock while holding the box
 * git lock, so the two-lock order is total and cannot cycle. Keep it that way —
 * a git-lock holder that wanted to mirror would have to release first.
 * (`lib/git-lock.ts` states the same invariant from its side.)
 *
 * ## Reentrancy passes through
 *
 * `mountDriveFolder` → `mirrorFolderOnce` and `syncFolderMount` →
 * `mirrorFolderOnce` are ordinary composition: an outer span calls an inner one
 * that also wants the lock. Like `withBoxGitLock`, a nested acquisition passes
 * straight through on the `AsyncLocalStorage` of paths this async context
 * already holds — the outer holder has exactly the exclusion the inner call
 * wants, and enqueueing behind our own ancestor would be an unbounded deadlock.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { withFileLock } from "../lib/file-lock.js";

/**
 * How long a second entrant waits before giving up with the holder's
 * `LockHeldError`. Generous because the span it waits on is a whole Drive sync
 * — many folders, each several API round-trips. It fails LOUD rather than
 * proceeding unserialized: unlike the git lock (where running unlocked just
 * yields git's own honest error), an unserialized second mirror silently
 * duplicates work against Drive.
 */
const DRIVE_MIRROR_LOCK_WAIT_MS = 5 * 60_000;

const heldPaths = new AsyncLocalStorage<ReadonlySet<string>>();

/** The lock file for a box. Gitignored, like every other lock we keep. */
function driveMirrorLockPath(boxRoot: string): string {
  return path.join(boxRoot, ".beebox", "drive-mirror.lock");
}

/** Run `fn` as the box's only Drive mirror writer. Reentrant. */
export async function withDriveMirrorLock<T>(boxRoot: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = driveMirrorLockPath(boxRoot);
  const outer = heldPaths.getStore();
  if (outer?.has(lockPath) === true) return fn();

  const nested = outer === undefined ? new Set<string>() : new Set(outer);
  nested.add(lockPath);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  return heldPaths.run(nested, () =>
    withFileLock(
      { lockPath, metadata: { purpose: "drive-mirror" }, waitMs: DRIVE_MIRROR_LOCK_WAIT_MS },
      fn,
    ),
  );
}
