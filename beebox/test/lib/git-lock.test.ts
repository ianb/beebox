// # Box Git Lock
//
// `withBoxGitLock(dir, fn)` serializes our writers on a box's repo-wide git
// index. It is reentrant by async context, queues same-process callers in FIFO
// order, and — the property that keeps it from ever wedging a box — logs loudly
// and runs `fn` unserialized rather than failing when it cannot acquire the lock.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { withBoxGitLock, activeBoxGitLockCount, BOX_GIT_LOCK_WAIT_MS } from "../../src/lib/git-lock.js";
import { acquireLock, releaseLock, LockHeldError } from "../../src/lib/file-lock.js";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { getStatus } from "../../src/lib/git/core/operations.js";
import { realpathSync } from "node:fs";
import * as os from "node:os";
import { join } from "node:path";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ## The lock is keyed on the git directory, not the caller's path
//
// A box is one repository with one git index, so two concurrent spans on the
// same box must serialize — the second waits for the first:
void test("A box is one repository with one git index, so two concurrent spans on the sa...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });

  const order: string[] = [];
  const outer = withBoxGitLock(box.root, async () => {
    order.push("first-enter");
    await delay(50);
    order.push("first-exit");
  });
  await delay(10);
  const inner = withBoxGitLock(box.root, async () => {
    order.push("second");
  });
  await Promise.all([outer, inner]);
  t.check(order, ["first-enter", "first-exit", "second"]);

  // The lock file itself lives inside the git directory, so holding it leaves
  // nothing behind in the working tree:

  await withBoxGitLock(box.root, async () => "held");
  t.check(await getStatus(box.root), { staged: [], modified: [], untracked: [], clean: true });
});

// ## Reentrancy passes through instead of deadlocking
//
// `proper-lockfile` is not reentrant, so a nested acquisition would stall until
// the wait budget expired. `stageAndCommitPaths` holds a span and calls
// `stageFiles` and `commitPaths` inside it, so nesting is ordinary composition
// here, not a bug — unlike `withCardLock`, which throws on the same situation.
//
// A nested call runs immediately, on the same held lock:
void test("proper-lockfile is not reentrant, so a nested acquisition would stall until t...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });

  const trace: string[] = [];
  await withBoxGitLock(box.root, async () => {
    trace.push("outer");
    await withBoxGitLock(box.root, async () => {
      trace.push("inner");
      await withBoxGitLock(box.root, async () => {
        trace.push("innermost");
      });
    });
  });
  t.check(trace, ["outer", "inner", "innermost"]);

  // Nesting is checked before the in-process queue. A nested call that enqueued
  // would wait behind its own ancestor — an unbounded deadlock rather than a
  // bounded one — so this finishing at all is the assertion:

  let queueDepthInsideNested = -1;
  await withBoxGitLock(box.root, async () => {
    await withBoxGitLock(box.root, async () => {
      queueDepthInsideNested = activeBoxGitLockCount();
    });
  });
  t.check(queueDepthInsideNested, 1);

  // The queue drains once the outer span completes:

  t.check(activeBoxGitLockCount(), 0);
});

// ## Same-process callers queue in FIFO order without polling
//
// Two concurrent tasks in one `bbx serve` would otherwise both poll the file lock
// at 100ms. The in-process chain runs them one at a time, in arrival order.
void test("Two concurrent tasks in one bbx serve would otherwise both poll the file lock...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });

  const log: string[] = [];
  const tasks = ["a", "b", "c"].map((name) =>
    withBoxGitLock(box.root, async () => {
      log.push(`${name}-enter`);
      await delay(20);
      log.push(`${name}-exit`);
    }),
  );
  await Promise.all(tasks);
  t.check(log, ["a-enter", "a-exit", "b-enter", "b-exit", "c-enter", "c-exit"]);

  // A caller that throws does not poison the queue behind it:

  const results: string[] = [];
  const failing = withBoxGitLock(box.root, async () => {
    throw new LockHeldError({ pid: 1, hostname: "test", acquiredAt: "now", metadata: {} });
  });
  const following = withBoxGitLock(box.root, async () => {
    results.push("ran anyway");
  });
  await failing.catch((e) => { results.push(`caught ${e.name}`); });
  await following;
  t.check(results, ["caught LockHeldError", "ran anyway"]);

  // That case also proves `fn` runs exactly once. The acquire path and `fn` can
  // both reject with `LockHeldError`, and without distinguishing them a throwing
  // `fn` would be retried unserialized:

  let calls = 0;
  await withBoxGitLock(box.root, async () => {
    calls += 1;
    throw new LockHeldError({ pid: 1, hostname: "test", acquiredAt: "now", metadata: {} });
  }).catch(() => {});
  t.check(calls, 1);
});

// ## A directory outside a repository runs unlocked
//
// There is no index to serialize on, and inventing an error here would hide
// whatever git actually reports.
void test("There is no index to serialize on, and inventing an error here would hide wha...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();

  t.check(await withBoxGitLock(box.root, async () => "ran"), "ran");
});

// ## When the lock cannot be acquired, `fn` runs anyway — loudly
//
// This is the property that keeps the lock from ever wedging a box. A SIGKILLed
// holder's guard directory only becomes reclaimable after the 5-minute stale
// window, so failing hard at the wait budget would turn one crashed process into
// minutes of failing writers — a worse failure than the one being fixed. Instead
// the caller warns and proceeds unserialized, which is the behaviour that
// predates the lock.
//
// Take the lock as another owner would, then contend for it. The wait budget is
// shortened via the test-only `BBX_BOX_GIT_LOCK_WAIT_MS` override so the test does
// not spend a real minute expiring it.
void test("This is the property that keeps the lock from ever wedging a box.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  process.env["BBX_BOX_GIT_LOCK_WAIT_MS"] = "300";
  const errors: string[] = [];
  const realError = console.error;
  console.error = (...args) => { errors.push(args.map(String).join(" ")); };

  // Hold the lock as an unrelated owner would, then release our in-process
  // record of it so `withBoxGitLock` sees a foreign holder.
  const gitDir = join(box.root, ".git");
  const lockPath = join(gitDir, "beebox-index.lock");
  await acquireLock(lockPath, { purpose: "doctest-foreign-holder" });

  const result = await withBoxGitLock(box.root, async () => "ran unserialized");
  console.error = realError;
  t.check(result, "ran unserialized");

  // The degradation is never silent — it names the holder and says plainly that the
  // operation was not serialized:

  t.check(errors, [
    str`[box-git-lock] could not acquire ${join(realpathSync(box.root), ".git", "beebox-index.lock")} within 300ms (held by pid ${String(process.pid)} on ${os.hostname()} since ${any(String)}). Proceeding WITHOUT the lock: this git operation is not serialized against other writers, and may fail on .git/index.lock or co-commit another writer's staged files. A holder this old is either crashed (its lock clears at the stale window) or is not one of ours — investigate what is holding the box's git index.`,
  ]);

  // The shipped budget is a minute — long enough that only a writer outside our
  // control reaches it:

  await releaseLock(lockPath);
  delete process.env["BBX_BOX_GIT_LOCK_WAIT_MS"];
  t.check(BOX_GIT_LOCK_WAIT_MS, 60000);
});
