/**
 * The box git lock — cross-process serialization of our writers on a box's
 * git index.
 *
 * ## Why
 *
 * A git repository's index is one repo-wide mutex: `.git/index.lock` admits
 * exactly one process no matter how narrow a pathspec each writer uses. Our
 * code treats commits as independent per-path operations, so two writers on
 * one box race, and the loser gets
 * `fatal: Unable to create '<box>/.git/index.lock': File exists`. That is a
 * failure for work nobody is watching — a scheduled task loses the race and
 * waits a day for its next cadence.
 *
 * This wraps every span in which OUR code holds the index, so contention
 * between our own writers becomes queueing instead of failure. It also makes a
 * stage-then-commit pair atomic, which a per-operation retry never could: two
 * mutations on different files could otherwise interleave their staging and be
 * co-committed under one caller's attribution.
 *
 * ## The central property: this lock can never wedge a box
 *
 * It is a cooperation optimization, not a correctness barrier. When it cannot
 * be acquired within {@link BOX_GIT_LOCK_WAIT_MS}, the caller logs LOUDLY and
 * runs anyway, unserialized — which is exactly the behaviour that predates this
 * module. Failing hard instead would introduce a failure worse than the one
 * being fixed: a SIGKILLed holder's guard directory is only reclaimable after
 * the `default` profile's 5-minute stale window (`file-lock.ts`
 * `LOCK_STALE_MS`), so a hard failure at 60 s would turn one crashed process
 * into four further minutes of failing writers.
 *
 * Proceeding unlocked is also what produces the honest error. A crashed holder
 * leaves no `.git/index.lock` behind, so the unlocked attempt just succeeds. A
 * live foreign holder does hold it, so git reports real index contention, which
 * `withIndexLockRetry` in `git.ts` turns into a typed `GitIndexLockError`. We
 * never report "our lock timed out" when the truth is "another process holds
 * the git index".
 *
 * ## What it does not do
 *
 * It serializes COOPERATING writers. Box agents shell out to raw `git` and
 * cannot be made to take it. That is survivable and is the reason the lock
 * belongs on our writers: it does not stop an agent from holding the index, it
 * makes every one of our writers WAIT for it rather than die. It also cannot
 * see a foreign writer's staged entries, so a whole-tree writer of ours
 * (`stageAll` + `commit`) can still sweep them into its own commit — path-scoped
 * commits (`stageAndCommitPaths`) are immune, and `cb tick` already defers its
 * sweep while a chat is active.
 *
 * ## Reentrancy: pass through, do not throw
 *
 * `proper-lockfile` is not reentrant, so a nested acquisition would stall until
 * the budget expired. We detect nesting through an `AsyncLocalStorage` of the
 * lock paths the current async context holds — the same mechanism
 * `card-lock.ts` uses — and pass straight through.
 *
 * This is the opposite of `withCardLock`, which throws `ReentrantCardLockError`
 * rather than deadlocking, and the difference is deliberate. `withCardLock`
 * protects a semantic read-modify-write of one file, where nesting means a
 * caller is doing two overlapping RMWs — a bug, statically fixable. This lock
 * protects a RESOURCE, the repository index, where nesting is ordinary
 * composition: a command holds a span and calls a helper that commits. Over a
 * hundred call sites reach the index through several layers each, and throwing
 * would convert every latent nesting into a production crash discovered one
 * path at a time. Passing through is also correct on the merits — the outer
 * holder already has the exclusion the inner call wants.
 *
 * Reentrancy is checked BEFORE the in-process queue. A nested call that
 * enqueued would wait behind its own ancestor, which is an unbounded deadlock
 * rather than a bounded one.
 *
 * ## Two invariants callers must keep
 *
 * 1. **Do not BLOCK on another lock, and do not run an agent or any other
 *    unbounded work, while holding this lock.** The established order is
 *    `withCardLock` → box git lock, and `question-transition.ts`'s file lock →
 *    box git lock. Nothing blocks the other way, so there is no cycle; keep it
 *    that way. `core/agent/commit.ts` is the concrete trap — its
 *    status-check-through-commit span contains a full `agent.invoke`, so only
 *    its `stageAll` + `commit` tail goes inside the lock.
 *
 *    A NON-blocking probe of another lock is fine, and there is one:
 *    `cb tick`'s housekeeping span calls `loadActiveChats` inside this lock to
 *    re-check for a live chat immediately before sweeping the tree
 *    (`cli/commands/tick-helpers.ts`). That reads chat locks through
 *    `scanLocks`, which acquires with proper-lockfile's default `retries: 0`
 *    and returns at once. The reverse edge does exist — a chat session holds
 *    its `active-chats` lock while its agent's `cb` calls take this one — so
 *    the ordering is only acyclic BECAUSE that probe never waits. Keep it
 *    non-blocking, and move the probe out of the span rather than making it
 *    wait.
 * 2. **Nothing invoked from a git hook may take this lock.** A hook runs as a
 *    child of the `git commit` we are holding the lock across. True today: the
 *    installed pre-commit hook runs `git annex pre-commit` and `cb validate
 *    --pre-commit`, and of those only `validate` touches git, only to read
 *    (`git diff --cached`, `git cat-file`). If this is ever broken the consequence is a 60 s stall and a
 *    loud log, not a deadlock — that is the fail-open backstop earning its keep,
 *    not a licence to break it.
 *
 * ## Scope
 *
 * Cross-process, one machine — everything `file-lock.ts` scopes itself to. The
 * lock lives inside the repository's git directory (which is per-worktree, and
 * so is the index), never in the working tree, so it is unversioned by
 * construction and disappears with the repo.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import * as path from "node:path";
import { simpleGit } from "simple-git";
import { LockHeldError, withFileLock } from "./file-lock.js";

/**
 * How long a caller waits for the lock before giving up and running
 * unserialized. Time spent while PREDECESSORS run git is work rather than a
 * stall and is not covered — this bounds waiting, not end-to-end latency.
 *
 * One constant, not a per-call-site knob: our writers hold the lock for well
 * under a second, so the budget is only reached when something outside our
 * control holds the index, and waiting longer does not help there. Exported so
 * tests can assert against it rather than restate it.
 */
export const BOX_GIT_LOCK_WAIT_MS = 60_000;

/**
 * Test-only override of the wait budget, in milliseconds. Exercising the
 * fail-open path means letting the budget actually expire, and a test cannot
 * spend a minute doing that. Not a production knob: nothing sets it outside
 * tests, and a malformed value falls back to the default rather than taking a
 * box down over a debugging aid.
 */
const WAIT_MS_ENV = "CB_BOX_GIT_LOCK_WAIT_MS";

function waitBudgetMs(): number {
  const override = process.env[WAIT_MS_ENV];
  if (override === undefined) return BOX_GIT_LOCK_WAIT_MS;
  const parsed = Number(override);
  if (!Number.isFinite(parsed) || parsed < 0) {
    console.warn(
      `[box-git-lock] ignoring malformed ${WAIT_MS_ENV}=${override}; ` +
        `using the default ${String(BOX_GIT_LOCK_WAIT_MS)}ms budget.`,
    );
    return BOX_GIT_LOCK_WAIT_MS;
  }
  return parsed;
}

/** Lock filename inside the repository's git directory. */
const LOCK_FILE_NAME = "callback-box-index.lock";

/**
 * Resolved lock path per input directory. `boxRoot` (`content/` on a
 * shapeVersion-2 box) and the package root are DIFFERENT directories in the
 * SAME repository — `docs-gen` commits at the package root while everything
 * else uses `boxRoot` — so keying the lock on the caller's directory string
 * would hand one index two locks. Resolving to the git directory collapses
 * them.
 *
 * The cache holds the in-flight PROMISE, not just the settled value, so
 * concurrent first callers on one repository share a single `git rev-parse`
 * instead of each spawning their own. That is what makes the queue's arrival
 * order the callers' own order: with a value-only cache every one of them
 * missed, and which reached {@link enqueue} first was decided by which
 * subprocess happened to exit first — reordering the queue relative to the
 * order the callers were created (reproduced ~1 round in 30, and far more
 * often on a loaded machine; it is why `git-lock.doctest.md`'s FIFO case
 * flaked). Sharing one promise means every caller resumes from the same
 * `await` in the order it attached.
 */
const lockPathCache = new Map<string, Promise<string | null>>();

/** Lock paths held by the current async context. Detects nesting; carries no
 *  other state. */
const heldLocks = new AsyncLocalStorage<ReadonlySet<string>>();

/** Tail of the in-process queue per lock path. Stored tails never reject, so
 *  one caller's failure cannot poison the queue behind it. */
const chains = new Map<string, Promise<void>>();

/**
 * The lock path for the repository containing `dir`, or null when `dir` is not
 * in one (there is then no index to serialize on, and git itself will report
 * whatever is actually wrong).
 */
function resolveLockPath(dir: string): Promise<string | null> {
  const key = path.resolve(dir);
  const cached = lockPathCache.get(key);
  if (cached !== undefined) return cached;

  const pending = computeLockPath(key);
  lockPathCache.set(key, pending);
  // A null result is deliberately NOT cached: `initRepo` creates a repository
  // where none was, and the commit that follows must find the lock. Evicting
  // after the fact (rather than not inserting) is what lets concurrent callers
  // share the one in-flight resolution.
  void pending.then((lockPath) => {
    if (lockPath === null && lockPathCache.get(key) === pending) lockPathCache.delete(key);
  });
  return pending;
}

/** The resolution itself. Never rejects: "not a repository" is a null. */
async function computeLockPath(key: string): Promise<string | null> {
  let gitDir: string;
  try {
    gitDir = (await simpleGit(key).revparse(["--absolute-git-dir"])).trim();
  } catch (_e) {
    // Not a repository, or the directory does not exist.
    return null;
  }
  if (gitDir === "") return null;
  return path.join(gitDir, LOCK_FILE_NAME);
}

/** Run `task` after everything already queued for `lockPath`. */
function enqueue<T>(lockPath: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(lockPath) ?? Promise.resolve();
  const run = previous.then(task);

  const tail = run.then(
    () => {},
    () => {},
  );
  chains.set(lockPath, tail);

  // Compare-and-delete: drop the entry only if nobody chained after us, so the
  // map holds live queues rather than every repo ever touched.
  void tail.then(() => {
    if (chains.get(lockPath) === tail) chains.delete(lockPath);
  });

  return run;
}

interface AcquireOptions {
  lockPath: string;
  /** The budget this caller entered with, for the fail-open message. */
  budgetMs: number;
  /** Wall-clock instant, taken when the caller ENTERED, past which we stop
   *  waiting. Taken at entry rather than at the head of the queue so total time
   *  spent waiting for locks stays inside one budget. */
  deadline: number;
  held: ReadonlySet<string>;
}

async function acquireThenRun<T>(options: AcquireOptions, fn: () => Promise<T>): Promise<T> {
  const { lockPath, budgetMs, deadline, held } = options;
  const waitMs = Math.max(0, deadline - Date.now());

  // Distinguishes "the acquire timed out" from "`fn` itself threw a
  // LockHeldError". Without it, an `fn` that threw one would run twice. A
  // mutable holder rather than a plain `let`: control-flow analysis narrows a
  // `let entered = false` to the literal `false` inside the catch (it does not
  // track the assignment made in the callback), which makes the guard below
  // look statically dead.
  const entered = { value: false };
  try {
    return await withFileLock(
      { lockPath, metadata: { purpose: "box-git-index" }, waitMs },
      async () => {
        entered.value = true;
        return heldLocks.run(held, fn);
      },
    );
  } catch (e) {
    if (entered.value || !(e instanceof LockHeldError)) throw e;
    console.error(
      `[box-git-lock] could not acquire ${lockPath} within ${String(budgetMs)}ms ` +
        `(held by pid ${String(e.holder.pid)} on ${e.holder.hostname} since ${e.holder.acquiredAt}). ` +
        "Proceeding WITHOUT the lock: this git operation is not serialized against other " +
        "writers, and may fail on .git/index.lock or co-commit another writer's staged files. " +
        "A holder this old is either crashed (its lock clears at the stale window) or is not " +
        "one of ours — investigate what is holding the box's git index.",
    );
    return heldLocks.run(held, fn);
  }
}

/**
 * Run `fn` while holding the git-index lock for the repository containing
 * `dir`. Reentrant: a nested call from within a held span runs `fn` directly.
 * Never throws on its own behalf — `fn`'s errors propagate, and a lock we
 * cannot acquire logs loudly and runs `fn` unserialized (see the module
 * comment).
 *
 * `dir` may be any directory inside the repository; `boxRoot` and the package
 * root of the same box resolve to one lock.
 */
export async function withBoxGitLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = await resolveLockPath(dir);
  if (lockPath === null) return fn();

  const held = heldLocks.getStore();
  if (held?.has(lockPath) === true) return fn();

  const nextHeld = new Set(held);
  nextHeld.add(lockPath);
  const budgetMs = waitBudgetMs();
  const deadline = Date.now() + budgetMs;

  return enqueue(lockPath, () =>
    acquireThenRun({ lockPath, budgetMs, deadline, held: nextHeld }, fn),
  );
}

/**
 * Number of repositories with a live in-process queue (in-flight or waiting
 * work). Read-only introspection for tests and diagnostics; a drained map
 * reports 0. Mirrors `activeCardLockCount` in `card-lock.ts`.
 */
export function activeBoxGitLockCount(): number {
  return chains.size;
}
