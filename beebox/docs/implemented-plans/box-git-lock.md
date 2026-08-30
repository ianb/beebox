---
title: "Box git lock — serialize our writers on the repo-wide git index"
status: implemented
workstream: box-git-lock
issues:
  - ../../../issues/closed/bugs/2026-08-18-scheduled-task-dies-on-git-index-lock.md
---

# Box git lock — serialize our writers on the repo-wide git index

A box's git index is one repo-wide mutex. Our code treats commits as
independent per-path operations and handles collision with a single retry.
This plan puts a cross-process lock around every span in which our code holds
the git index, so contention between our own writers becomes a bounded wait
instead of a failure, and so a stage-then-commit pair stops being two
separately-raced operations.

The lock is a **cooperation optimization, not a correctness barrier**. It can
never make a box worse off than it is today: when it cannot be acquired within
its budget, the caller logs loudly and proceeds unlocked, which is exactly
today's behaviour. That property is deliberate and load-bearing — a wedged
production box is a worse failure than the one being fixed.

## Issues addressed

- `issues/bugs/2026-08-18-scheduled-task-dies-on-git-index-lock.md` — a
  scheduled procedure died on `.git/index.lock` after 6.5 s, four times in a
  row.
- `issues/closed/bugs/2026-07-05-git-commit-race-audit.md` (already closed) —
  its Track H deferral (`stageFiles` + `commit` are "two non-atomic git ops
  sharing one `.git/index.lock`") is closed for cooperating writers by the same
  lock. The issue stays closed; this plan records that its deferral is now
  resolved for our own writers, and explicitly not for others (see "The limits,
  stated precisely").

Grep of the queue for `index.lock`, `git lock`, `commit race`, `stageAndCommit`
turned up no other open item.

## Stated preferences this plan trades against

- `docs/engineering-principles.md` **§4 Resilient AND never silent — and never
  resilient to the impossible.** The wait is bounded; its expiry is loud; and
  the degradation on expiry is to today's behaviour, not to a new failure.
- `docs/engineering-principles.md` **§6 Right-sized defensiveness.** The lock
  cannot make cooperating writers safe from a non-cooperating one (a box agent
  shelling out to raw `git`). The design must not pretend otherwise, and this
  plan removed one mechanism (a child-process environment marker) that only
  looked like it helped.
- `docs/engineering-principles.md` **§8 One way to do each thing.** There is
  already one door for path-scoped commits (`stageAndCommitPaths`) and one
  cross-process lock primitive (`file-lock.ts`). This plan adds no third
  mechanism; it composes those two and deletes the one bespoke commit
  serializer that predates them (`src/core/capture/prepare.ts:136`).
- `docs/engineering-principles.md` **§10 Testability is architectural.** A
  single-process test cannot demonstrate cross-process exclusion. The lock's
  proof is a multi-process doctest, following `test/lib/file-lock.doctest.md`.
- Root `CLAUDE.md` — "Bias toward strict in all things", bounded by "Stop
  over-engineering rare failures".
- `src/lib/file-lock.ts:1-40` module comment — *"Don't add a new lock surface
  elsewhere — extend or wrap this instead."* This plan wraps.

## What already exists

| Thing | Where | Reuse or rebuild |
|---|---|---|
| Cross-process lock on `proper-lockfile`, with mtime-freshness stale recovery, `LockHeldError`, and a bounded-wait wrapper `withFileLock({lockPath, metadata, waitMs}, fn)` | `src/lib/file-lock.ts:437` | **Reuse** — unchanged. |
| Stale profiles: `default` 5 min, `request` 15 s | `src/lib/file-lock.ts:171-174` | **Reuse `default`.** Our critical section runs a `git` subprocess, which is exactly the case the module comment says stays on `default`: *"a lock whose critical section runs a subprocess or arbitrary caller work stays on `default`."* The 5-min stale window vs. the 60 s wait budget is a real tension — see Track A.4. |
| Reentrancy detection by `AsyncLocalStorage` of held keys | `src/lib/card-lock.ts:103-121`; the error class at `src/lib/card-lock.ts:82-92` | **Reuse the mechanism, invert the decision** — see "Reentrant pass-through vs. throwing". |
| The single path-scoped stage+commit door | `src/lib/git.ts:309` `stageAndCommitPaths` | **Reuse** — gains a lock around its span. |
| One-shot index-lock retry | `src/lib/git.ts:146` `withIndexLockRetry` | **Keep** — it is the only defence against a non-cooperating writer (a box agent's raw `git`, a git-lfs hook). It stops being the primary mechanism and becomes the honest reporter of external contention (Track D). |
| Index-lock error detection by message match | `src/lib/git-internal.ts:43-45`: `return message.includes("index.lock");` | **Reuse, and follow its precedent** for the cross-process marker in Track D. |
| Bespoke in-process commit chain for capture | `src/core/capture/prepare.ts:102,136,152` | **Delete** — subsumed by the new lock's in-process layer. |
| Deferral of tick's housekeeping commit while a chat is active | `src/cli/commands/tick-helpers.ts:189-201` | **Reuse, unchanged** — see "NOT in scope". |
| Multi-process doctest harness (spawn a real child, SIGKILL it mid-hold) | `test/lib/file-lock.doctest.md:40-56`, `test/helpers/file-lock-child.ts` | **Reuse** — the new tests copy this shape. |

Multi-operation git spans that are today unserialized *as spans* (each gets an
explicit lock in Track C):

- `src/core/procedure/engine.ts:157-158` — `stageAll` + `commit`. This is the
  span the reported failure hit: a scheduled procedure's start commit, ~6 s in.
- `src/core/procedure/engine-step.ts:147,177,254` — three more `stageAll` + `commit`.
- `src/core/procedure/engine-orchestrate.ts:100-101` — `stageAll` + `commit`.
- `src/core/procedure/engine-phase.ts:171-192` — `getStatus` → `stageAll` → `commit`.
- `src/core/agent/commit.ts:83-87` — `stageAll` + `commit`. **Only these lines.**
  The surrounding function (`commit.ts:60-87`) also calls `agent.invoke` at
  `commit.ts:69`; wrapping the whole function would hold the git lock across a
  full agent run, which Track A.5 forbids.
- `src/cli/commands/tick-helpers.ts:195-211` — `getStatus` → `stageAll` → `commit`.
- `src/core/docs-gen/index.ts:345-346` — `stageFiles` + `commitPaths`, run at the
  **package root**, not `boxRoot`.
- `src/cli/commands/feedback.ts:178-180` — `stageFiles` + `commitPaths`.

The `docs-gen` case is load-bearing for the design: two callers pass **different
directories for the same repository** (`boxRoot` = `content/` on a
shapeVersion-2 box; `packageRoot` = the repo root). A lock keyed on the caller's
directory string would give them two different locks on one index. The lock is
therefore keyed on the resolved git directory.

## Prior art (external)

- **`proper-lockfile` is not reentrant.** Confirmed: it is an inter-process
  lockfile utility with no same-process re-acquire; reentrancy has to be
  wrapper logic. <https://www.npmjs.com/package/proper-lockfile>. This is the
  hazard the plan is built around.
- **Git's own answer to parallel writers is worktrees**, not a wait-for-lock
  flag: each worktree gets its own index and `HEAD` while sharing the object
  store. <https://www.augmentcode.com/guides/git-worktrees-parallel-ai-agent-execution>
  Not applicable here — a box is one working tree that many processes write,
  by design.
- **No `git` option waits for `index.lock`.** Searched for one; there is none.
  Every documented remedy is "find the other process" or "delete the lock file"
  (<https://learn.microsoft.com/en-us/azure/devops/repos/git/git-index-lock>),
  and deleting it is exactly the unconditional-unlink pattern
  `src/lib/file-lock.ts:20-30` says the project rejected. So an application-level
  lock is the only mechanism available.
- **Same problem, same conclusion, in another project:** cwlviewer's "Git
  Concurrency Issues" settled on a per-repository queue.
  <https://github.com/common-workflow-language/cwlviewer/issues/131>
- **`GIT_INDEX_FILE` as an alternative** (give each writer a private index, so
  they never contend on `.git/index.lock`): searched, and it does not solve the
  problem. Staging would stop contending, but `git commit` also takes
  `.git/HEAD.lock` and the branch ref lock, and two concurrent commits from
  private indexes would each build a tree from a different base, so the loser is
  rejected or silently discards the winner's changes. Recorded here so nobody
  re-derives it.
- **No prior art found** for a reentrant wrapper over `proper-lockfile` keyed on
  a git directory. That combination appears to be ours to write.

## Tracks / scope

Ordered by implementation dependency.

### Track A — `src/lib/git-lock.ts`, the box git lock

**What.** A new module exporting one primitive:

```ts
export async function withBoxGitLock<T>(dir: string, fn: () => Promise<T>): Promise<T>;
```

`dir` is any directory inside the box's repository (`boxRoot`, `packageRoot`, a
subdirectory — they all resolve to the same lock).

**Why this needs to change.** Nothing today serializes our writers against each
other. `withIndexLockRetry` (`src/lib/git.ts:146`) sleeps 2 s once and then
throws; the reported failure exhausted it.

**Direction.**

**A.1 — Lock identity is the git directory.** Resolve `git rev-parse
--absolute-git-dir` from `dir`; the lock path is
`<gitDir>/beebox-index.lock`. This is correct for the `boxRoot` vs
`packageRoot` split above, is per-worktree (matching the index's own scope), is
guaranteed to exist, and is guaranteed never to be committed. Resolutions are
cached per input directory; **failures are not cached** (`initRepo` creates a
repo where none was). When `dir` is not in a repository, `withBoxGitLock` runs
`fn` unlocked — git itself then produces its own honest error, rather than the
lock inventing one.

**A.2 — Reentrancy by async context only.** An
`AsyncLocalStorage<ReadonlySet<string>>` of lock paths held by the current async
context — the mechanism `src/lib/card-lock.ts:103-121` already uses. If the
current context holds this lock path, run `fn` directly. `fn` runs inside
`held.run(next, …)` on **every** path, including the fail-open path of A.4, so a
nested call never starts a second wait.

There is deliberately **no cross-process reentrancy mechanism.** An earlier
draft passed a `BBX_BOX_GIT_LOCK` marker into git's child environment so a hook's
`bbx` could bypass the lock. That was cut: an environment variable is ambient
authority, not proof of ownership — it is inherited by detached grandchildren
(the post-commit hook backgrounds `bbx validate --urls`,
`src/core/install-validation-hooks.ts:187-188`, which can outlive the lock), and
anything that inherits or sets it runs unlocked. It also was not needed. Its job
is done by A.5's invariant plus A.4's fail-open backstop.

**A.3 — In-process FIFO queue in front of the file lock.** A per-lock-path
promise chain runs same-process contenders one at a time with no polling; only
the chain head contends for `withFileLock`. Without this, two concurrent tasks
in one `bbx serve` poll at `LOCK_RETRY_MS` = 100 ms
(`src/lib/file-lock.ts:423`) — a latency the capture path measures and already
avoids with its own chain (`src/core/capture/prepare.ts:136`). Reentrant calls
(A.2) are checked **before** the queue: a nested call that enqueued would wait
behind its own ancestor, which is an unbounded deadlock, not a bounded one.

**A.4 — One deadline, measured at entry, and fail-open on expiry.**

```ts
const deadline = Date.now() + BOX_GIT_LOCK_WAIT_MS;   // 60_000
// … in-process queue …
const remaining = Math.max(0, deadline - Date.now());
let ran = false;
try {
  return await withFileLock({ lockPath, metadata, waitMs: remaining },
    async () => { ran = true; return held.run(next, fn); });
} catch (e) {
  if (ran || !(e instanceof LockHeldError)) throw e;
  console.error(`[box-git-lock] could not acquire ${lockPath} within ${…}ms ` +
    `(held by pid ${e.holder.pid} since ${e.holder.acquiredAt}); proceeding ` +
    `WITHOUT the lock — this git operation is not serialized against other writers.`);
  return held.run(next, fn);
}
```

Three properties, each doing real work:

- **The deadline is taken at entry, not at the head of the queue.** A caller
  therefore never spends more than 60 s *waiting for locks* in total. Time spent
  while predecessors actually run git is work, not a stall, and is not bounded —
  this is what serialization costs, and stating it precisely is better than
  claiming a bound that does not hold.
- **The `ran` sentinel** distinguishes "the acquire timed out" from "`fn` itself
  threw a `LockHeldError`". Without it, a `fn` that threw one would be silently
  executed twice.
- **Expiry proceeds unlocked.** This is the design's most important property and
  it resolves two failure modes at once:
  - **A crashed holder does not wedge the box.** A SIGKILLed holder's guard dir
    is reclaimable only after the `default` profile's 5-min stale window
    (`file-lock.ts:171-173`), which is longer than any wait budget an HTTP path
    can tolerate. Failing hard at 60 s would turn one crash into ~4 further
    minutes of failing writers — a *new* failure this plan would have
    introduced. Proceeding unlocked instead succeeds immediately, because a
    crashed node process leaves no `.git/index.lock` behind.
  - **A non-cooperating holder gets the honest error, not an invented one.**
    Proceeding unlocked hands the operation to git, which either succeeds (the
    index is free) or fails with a real index-lock error that
    `withIndexLockRetry` turns into `GitIndexLockError` (Track D). We never
    report "our lock timed out" when what happened is "another process holds
    the git index."

The 60 s budget is a single constant, not a per-call-site knob. Our writers hold
the lock for well under a second, so 60 s is only reached when something outside
our control holds it, and in that case waiting longer does not help.

**A.5 — Two documented invariants**, in the module comment:

1. *Do not BLOCK on another lock, and do not run an agent or any other
   unbounded work, while holding the box git lock.* A non-blocking probe of
   another lock is fine, and one exists: `bbx tick`'s span calls
   `loadActiveChats` inside the lock, which reads chat locks through
   `scanLocks` (proper-lockfile `retries: 0`, returns at once). The reverse
   edge is real — a chat session holds its `active-chats` lock while its
   agent's `bbx` calls take the git lock — so the ordering is acyclic only
   because that probe never waits. The existing order is
   `withCardLock` → box git lock (`card-lock.ts:33-38` already tells callers to
   wrap the git commit inside the card lock), and `question-transition.ts`'s
   file lock → box git lock. Nothing goes the other way, so there is no cycle;
   the rule keeps it that way. `src/core/agent/commit.ts:69` is the concrete
   trap this rule exists to prevent (see Track C).
2. *Nothing invoked from a git hook may take the box git lock.* Verified true
   today: the installed pre-commit hook runs `git annex pre-commit .`,
   `bbx validate --staged`, `bbx validate --links`, and
   `bbx attachments check-unlisted` (`src/core/install-validation-hooks.ts:248-285`);
   of these only `validate` touches git at all, and only to read
   (`src/cli/commands/validate.ts:28` imports `getStatus` and nothing else). If
   the invariant is ever broken, A.4's fail-open makes the consequence a 60 s
   stall and a loud log, not a deadlock.

**First implementation chunk.** `src/lib/git-lock.ts` plus
`test/lib/git-lock.doctest.md`, with no `git.ts` changes yet. No open questions
inside it.

### Track B — take the lock in `src/lib/git.ts`

**What.** Every index-mutating export wraps itself in `withBoxGitLock`;
`stageAndCommitPaths` wraps its whole span.

**Why this needs to change.** A lock nobody takes is not a lock. And
`stageAndCommitPaths` is check-then-act (`pathsHaveChanges` → `stageFiles` →
`stagedPaths` → `commitPaths`, `src/lib/git.ts:309-336`); only a span lock makes
it atomic.

**Direction.**

- **Wrapped** (writes the index or the working tree): `stageFiles`,
  `unstageFiles`, `stageAll`, `commit`, `commitPaths`, `stageAndCommitPaths`,
  `resetHard`, `clean`, `revertToSnapshot`, `createBranch`, `checkoutBranch`.
  The last two are included because `git checkout` rewrites the index and the
  working tree (`src/lib/git.ts:468,475`) and so contends with every commit.
- **Not wrapped, deliberately:** `initRepo` (no repo yet); `createTag` /
  `deleteTag` (`git.ts:482,489` — these write refs, not the index);
  `pushToRemote` (no index); and every reader — `getStatus`, `getLog`,
  `getDiff`, `stagedPaths`, `pathsHaveChanges`, `getHead`, `gitBoxPrefix`,
  `hasCommits`, `getCommitDiff`, `isRepo`. Locking readers would serialize the
  whole system for no correctness gain; a reader that must be inside a span gets
  one from its caller (Track C).
- Wrapping is safe under nesting **because the lock is reentrant** (A.2):
  `stageAndCommitPaths` holds the span and its inner `stageFiles` /
  `commitPaths` pass straight through.
- `withIndexLockRetry` stays, inside the lock, unchanged in behaviour but with
  a new failure type — see Track D.

**First implementation chunk.** The `git.ts` edits plus a doctest asserting a
nested call does not deadlock and acquires the file lock exactly once.

### Track C — give multi-operation spans one lock

**What.** The nine call sites listed in "What already exists" wrap their span in
`withBoxGitLock`, and `src/core/capture/prepare.ts`'s bespoke `commitChain` /
`withCommitLock` / `commitPathsSerialized` are deleted in favour of it.

**Why this needs to change.** `stageAll` then `commit` under two separate lock
acquisitions is the exact interleaving the closed audit's Track H deferred: a
concurrent *cooperating* writer can stage between them and get co-committed
under this caller's attribution. The check-then-act sites (`getStatus` →
`stageAll` → `commit`) are worse — they decide *whether* to commit from a status
read taken outside the lock.

**Direction.** Most sites become:

```ts
await withBoxGitLock(boxRoot, async () => {
  const status = await getStatus(boxRoot);
  if (status.clean) return;
  await stageAll(boxRoot);
  await commit(boxRoot, { … });
});
```

The inner calls pass through reentrantly. `docs-gen` passes `packageRoot`,
which resolves to the same lock as `boxRoot` — that equivalence gets a doctest
assertion, since it is the one place the git-dir keying is load-bearing.

**`src/core/agent/commit.ts` is the exception and must not follow the shape
above.** `ensureAgentCommitted` (`commit.ts:60-87`) runs `getStatus` →
`agent.invoke` → `getStatus` → `stageAll` → `commit`. Only lines 83-87 go inside
the lock. The two `getStatus` calls stay outside it: they are advisory
"did the agent commit its own work" probes whose answer only selects between
"return" and "make a fallback commit", and a fallback commit that turns out to
be empty is already handled — `commit()` surfaces a nothing-to-commit error that
this path treats as the normal end state. Holding the lock across
`agent.invoke` would hold it for an entire agent turn, which A.5 forbids and
which would wedge every other writer on the box for minutes.

**First implementation chunk.** All nine sites in one commit, plus the capture
deletion.

### Track D — stop reporting a lost lock race as a broken task

**What.** A distinguishable failure when the index is genuinely held by someone
outside our control, surfaced through the scheduler and `bbx health` — including
across a process boundary, which is where the reported failure actually lives.

**Why this needs to change.** From the issue: *"The task surfaces in `bbx health`
as a plain `exit code 1`, which reads like the task is broken rather than like
it lost a lock race."* Four consecutive failures on a task whose code is fine
sends the reader to debug the wrong thing. Traces to §4: resilient, but never
silent, and never ambiguous about which failure happened.

**Direction.**

- `withIndexLockRetry` (`src/lib/git.ts:146`) throws a new `GitIndexLockError`
  (subclass of `GitCommandError`, defined beside `isIndexLockError` in
  `src/lib/git-internal.ts`) when the retried operation fails on
  `isIndexLockError` again — i.e. an external holder we could not wait out.
  After Track A this is the *only* contended failure type: a lock we cannot
  acquire no longer produces an error at all (A.4 proceeds unlocked), so
  "contended" now means one specific, true thing.
- `GitIndexLockError`'s message carries a stable token (`[git-contended]`), and
  `git-internal.ts` exports `isContendedFailure(message: string): boolean` that
  matches it.
- **Crossing the process boundary.** A scheduled task is a child process:
  `execWithTimeout` turns a non-zero exit into `Command failed with exit code N`
  plus an output tail (`src/lib/exec-with-timeout.ts:136-142`), `tick` stores
  `errorMessage(err)` (`src/cli/commands/tick-helpers.ts:264`), and health
  renders the stored string (`src/core/schedule/health.ts`). A JS error subclass
  does not survive that, so the token does the work: it reaches the parent in
  the captured stderr tail, and `tick-helpers`'s failure recording calls
  `isContendedFailure` on the message it is about to store.
  This is message-matching, chosen deliberately over restructuring the CLI's
  exit-code semantics (`src/cli/index.ts` ends in a bare `program.parse()`, so
  there is no central error handler to give a distinct exit code without
  changing every command's failure path). It follows the in-house precedent:
  `git-internal.ts:45` already detects this exact condition by
  `message.includes("index.lock")`. The token is ours, defined in one place.
- The script state records `contended: true` alongside the error, and `bbx health`
  renders such a failure as `contended — another process held the git index`
  rather than `exit code 1`, and does not count it toward the
  broken-task presentation.

**First implementation chunk.** The error type and token in `git-internal.ts` +
`git.ts`; then the tick/health rendering.

### Track E — `bbx feedback` commits in one span, not two

**What.** `src/cli/commands/feedback.ts:178-180` replaces its `stageFiles` +
`commitPaths` pair with a single `stageAndCommitPaths` call.

**Why this needs to change.** It is two lock acquisitions and one unguarded
interleaving window per feedback call, on a command whose whole point is to be
called freely mid-conversation. The issue records an observed commit storm on
2026-08-14.

**Direction.** One call, one locked span. Note deliberately what this does
**not** do: it does not batch or drop the commit. See "Open design questions".

**First implementation chunk.** The one-file change.

### Track F — the tests

Covered under "Rollout shape"; listed as a track because it is the largest
single piece of work and gates the others being believed.

## The limits, stated precisely

The lock serializes **cooperating writers**. Three things it does not do, each
of which an earlier draft of this plan overclaimed:

1. **It does not protect against a non-cooperating writer's staged entries.**
   A box agent (or an older `bbx` binary) can run `git add`, release
   `.git/index.lock`, and pause before its `git commit`. A locked whole-tree
   writer of ours (`stageAll` + `commit`) will then co-commit those staged
   entries under its own attribution. The app lock cannot see them. Two things
   bound the damage and neither is the lock: path-scoped commits
   (`stageAndCommitPaths` → `commitPaths`, `git.ts:261-286`) are immune because
   their pathspec excludes the foreign entries, and tick's whole-tree sweep
   already defers while a chat is active (`tick-helpers.ts:189-201`). The
   remaining whole-tree writers accept it, as they do today.
2. **It does not make our writers safe from a raw-`git` agent.** It makes them
   *wait* for one, and then — if the wait expires — fail with an honest,
   distinguishable error instead of an immediate one. That is the whole claim.
3. **It does not bound end-to-end latency.** It bounds time spent *waiting for
   locks* (A.4). Time spent while predecessors run git is unbounded in the
   number of predecessors.

## Could this be simpler?

**The simplest version that could plausibly work:** raise
`withIndexLockRetry`'s budget from one retry to a retry loop with backoff over
~60 s. Three lines, no new module, no reentrancy hazard, no deadlock risk at
all.

What the plan's fuller approach buys over it, concretely:

1. **The retry loop cannot make a span atomic.** `stageAll` then `commit` would
   still be two independently-retried operations, so the Track H interleaving
   (a concurrent writer's files co-committed under this caller's attribution)
   survives for cooperating writers too. That is a wrong-attribution data
   defect, not a latency problem, and no retry budget fixes it. Traces to §4:
   retrying a lost race is being resilient to the wrong failure.
2. **The retry loop makes contention worse under load.** Every contender polls
   git, and each poll is a subprocess that itself tries to take `index.lock`.
   With a queue, one contender waits on a cheap `mkdir` and the rest sleep.
   Traces to §6: right-sized defensiveness means not building a thundering herd.
3. **The retry loop cannot report honestly.** It cannot distinguish "eleven of
   our own writers are queued, this is normal" from "an external process has
   held the index for a minute". Track D depends on knowing which. Traces to §4.

**What the plan gives up to the simple version:** a genuine deadlock hazard that
did not exist before. That is why reentrancy is a designed property of Track A
and not an afterthought, and why A.4 fails open — between "correct exclusion"
and "cannot wedge a box", this plan picks "cannot wedge a box" every time.

**Where the plan deliberately stays small:** one wait constant, no per-call-site
tuning; no lock on readers; no new lock primitive (`file-lock.ts` is wrapped,
not extended); no cross-process reentrancy mechanism (cut during review); no
attempt to make box agents' raw `git` cooperate.

## Reentrant pass-through vs. throwing, and why this differs from `withCardLock`

`withCardLock` throws `ReentrantCardLockError` (`src/lib/card-lock.ts:82-92`)
rather than deadlocking. This plan passes through instead. The difference is
what the lock protects.

`withCardLock` protects a *semantic* read-modify-write of one file. Nesting
there means a caller is doing two overlapping RMWs on the same card — a bug at
the call site, statically fixable by factoring, and there are few such sites.

The box git lock protects a *resource*: the repository index. Nesting is
ordinary composition — a command holds a span and calls a helper that commits.
There are 102 index-mutating call sites across 37 files, many reached through
several layers. Throwing would convert every latent nesting into a production
crash, discovered one path at a time, and no static check can enumerate them.
Passing through is correct on the merits too: the outer holder already has the
exclusion the inner call wants.

Traces to §6 (right-sized defensiveness): the failure the strictness would
prevent — a caller relying on nesting for exclusion it does not have — cannot
occur, because the outer lock *is* the exclusion.

## Subplans

None. Each track is a design decision this document settles, not a research
question.

## Failure modes

> **Critical gap:** none remaining. The two that would have been critical —
> silent deadlock on nesting, and a crashed holder wedging the box for the
> 5-minute stale window — are the reason Track A has reentrancy (A.2) and
> fail-open expiry (A.4), and both get a test.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Nested `withBoxGitLock` in one async context (`stageAndCommitPaths` → `stageFiles`) | New: `git-lock.doctest.md` asserts a nested call completes and acquires once | ALS pass-through, checked before the queue (A.2, A.3) | N/A — does not fail |
| A holder is SIGKILLed mid-span (tick's 10-min script timeout) | New: `git-lock-recovery.doctest.md`, using `file-lock.doctest.md:40-56`'s crashed-holder helper | Contenders wait 60 s, then proceed unlocked and succeed (A.4) | **Clear** — loud `console.error` naming the dead holder's pid |
| A box agent's raw `git` holds `index.lock` longer than 60 s | New: doctest holds a real `.git/index.lock` and asserts a bounded, typed failure | 60 s wait → unlocked attempt → `withIndexLockRetry` → `GitIndexLockError` | **Clear** — typed, carries `[git-contended]`, distinct in health (Track D) |
| Lock is stolen mid-span (machine slept > 5 min while holding) | Not tested (would need a 5-min test) | `onCompromised` logs loudly (`file-lock.ts:266-280`) | **Clear** — loud `console.error`; degrades to today's behaviour |
| A non-cooperating writer's staged entries get co-committed by our whole-tree writer | No | None — see "The limits, stated precisely" #1 | **Silent, and accepted** — unchanged from today; path-scoped commits are immune, tick already defers |
| `withBoxGitLock` called on a directory that is not a repo | Existing `git.ts` doctests cover the non-repo error | Run unlocked; git reports it | **Clear** — git's own message |
| `git rev-parse --absolute-git-dir` fails transiently | No | Treated as "not a repo": run unlocked, do not cache | **Silent** — accepted: the operation then behaves exactly as it does today (root `CLAUDE.md`, stop-over-engineering) |
| Two callers use different dirs for one repo (`boxRoot` vs `packageRoot`) | New: doctest asserts both resolve to one lock path | Git-dir keying (A.1) | N/A — does not fail |
| A future caller holds the lock across an agent run | No (cannot be tested for) | Invariant A.5.1; `agent/commit.ts` is fixed in Track C as the one live instance | **Bounded if violated** — 60 s stall, loud log, then unlocked progress. Not a wedge. |
| A future git hook takes the lock its parent holds | No (cannot be tested for) | Invariant A.5.2, verified true today; A.4 is the backstop | **Bounded if violated** — 60 s stall per commit, loud log |
| In-process queue grows under sustained load | No | Each head is bounded by A.4, so the queue always drains | **Clear** — latency, not a stall; stated as a limit rather than claimed away |
| A `fn` that itself throws `LockHeldError` gets run twice | New: `git-lock.doctest.md` asserts single execution | The `ran` sentinel (A.4) | N/A — does not fail |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — **N/A.** No card syntax, no field, no vocabulary
  an agent chooses between.
- **Stale ref** — **N/A.** No refs.
- **Two agents touching the same card** — **ADDRESSED, partly.** Two of *our*
  processes writing one box now queue instead of one dying (Track A). Two
  processes' *content* conflicting is unchanged: this lock serializes commits,
  it does not merge edits — `withCardLock` owns same-file RMW and stays
  separate.
- **Hand-edit drift** — **N/A.** Nothing hand-editable changes.
- **Fabricated free-form value** — **N/A.** No agent-authored value.
- **Validation error UX** — **ADDRESSED.** The pre-commit validation hook runs
  *inside* our lock, so a validation failure aborts the commit and the lock
  releases normally through `withFileLock`'s `finally`. The hook itself takes no
  lock (A.5.2, verified).
- **Partial migration / transition state** — **ADDRESSED.** No data-shape or
  on-disk-format change, so there is no bilingual window. The real transition
  risk is **mixed versions on one box**: a deployed `bbx serve` holding the new
  lock while an older `bbx` binary (a stale hook path, an agent's `bbx` from
  another checkout) commits without taking it. The old writer is then exactly a
  non-cooperating writer, with the limits stated above — it can still lose a
  race, and its staged entries are still visible to a whole-tree sweep. Neither
  is a regression; both are today's behaviour. Nothing wedges, and both sides
  converge on the next deploy.
- **A box agent that never takes the lock** — **ADDRESSED as a stated limit.**
  See "The limits, stated precisely". The design does not depend on the agent
  cooperating.

## NOT in scope

- **Making box agents take the lock** (a wrapped `git` command they are told to
  use). It is guidance, not a guarantee, and the design must not depend on it.
- **Closing limit #1** (a non-cooperating writer's staged entries swept into our
  whole-tree commit). Closing it needs whole-tree writers to commit by explicit
  pathspec, which is a separate and much larger change to what those commits
  mean. It is unchanged from today, and it is now written down rather than
  assumed away.
- **Deferring scheduled work on the `active-chats` signal** (the issue's part
  3). Two reasons. First, it is **already built** for the case it fits:
  `findBusyBlockers` (`src/cli/commands/tick-helpers.ts:76-91`) blocks a whole
  tick on an active chat, and `handlePostSuccess` (`tick-helpers.ts:189-201`)
  re-checks immediately before the housekeeping commit. Second, it **would not
  have prevented the reported failure**: that procedure died ~6.5 s into its own
  run, at `src/core/procedure/engine.ts:157`, from contention that arose
  *during* the run. A pre-run deferral gate cannot see that. The lock can.
  Deferral and locking answer different questions and the issue conflates them.
- **Batching or dropping `bbx feedback`'s commit.** See Open questions — a
  behaviour change that needs the developer's call, and the lock removes its
  urgency.
- **Locking read operations.** Would serialize the whole system for no
  correctness gain.
- **A cross-machine lock.** `file-lock.ts:1-40` scopes the primitive to one
  machine; boxes are written from one machine.
- **Replacing `withIndexLockRetry`.** It remains the only defence against a
  non-cooperating writer, and Track D's honest reporter.
- **Giving `bbx` a central error handler and distinct exit codes.** Track D uses
  a message token instead; the exit-code route would change every command's
  failure path for one diagnostic.
- **Reducing commit volume generally** (the issue's part 4 beyond feedback).
  Worth doing; not this plan. It is a mitigation of contention, and this plan
  removes the reason contention is fatal.

## Open design questions

- **Should `bbx feedback` commit at all?** Today it writes a file and commits it
  (`feedback.ts:178-180`). It could write the file and let the box's next sweep
  commit it, removing one commit per call entirely. Against: feedback would sit
  uncommitted on a box that is not ticking, and the command's contract
  ("recorded") would weaken. **Lean: keep the commit**, because the lock makes
  its cost a short wait rather than a failure, and because the alternative
  trades a durability guarantee for a contention win we no longer need. This is
  a behaviour change either way, so it is the developer's call; Track E ships
  the safe half (one span instead of two) regardless.
- **Is 60 s the right budget?** It is a guess informed by the shape of the
  problem, not a measurement. **Lean: ship 60 s.** Fail-open makes the cost of
  guessing wrong low in both directions — too short means an occasional
  unserialized operation with a loud log, not a failure. Revisit if the
  fail-open log is ever seen.

## Knowledge audits

**Skip, with rationale.** This plan introduces no agent-facing concept. Box
agents do not call `withBoxGitLock`; they shell out to raw `git`, which the plan
explicitly does not change. The audience for the new convention is *this*
repository's maintainers, and `src/dev/knowledge-audits.yaml` tests what a box
agent knows — dev-repo guidance is invisible to it (per the `knowledge-audit`
skill). The convention lands as a module comment in `src/lib/git-lock.ts`, a
cross-reference from `src/lib/file-lock.ts`'s lock table, and a line in
`code-style.md`'s async-error-handling list beside the existing `file-lock` and
`withCardLock` entries.

## Implementation order

1. **Track A** — `src/lib/git-lock.ts` + `test/lib/git-lock.doctest.md`.
   Standalone; nothing depends on it yet.
2. **Track B** — `src/lib/git.ts` takes the lock. Depends on A.
3. **Track F (first half)** — the two-process race doctest. Depends on B. This
   is the gate: until it passes, nothing else is worth building.
4. **Track C** — the nine explicit spans; delete capture's `commitChain`.
   Depends on B.
5. **Track D** — `GitIndexLockError`, the token, tick recording, health
   rendering. Depends on B.
6. **Track E** — `bbx feedback` single span. Depends on B.
7. **Track F (second half)** — crash-recovery and fail-open doctests.
8. Cross-model review (`/cross-model`) of the implementation before the plan is
   called complete. (A first pass ran against the draft plan; its findings are
   folded in above.)

## Rollout shape

**Test posture.** Three new doctests, named as part of the design:

- `test/lib/git-lock.doctest.md` — the unit-level contract of `withBoxGitLock`:
  reentrant pass-through in one async context, checked before the queue;
  `boxRoot` and `packageRoot` resolving to one lock path; non-repo directories
  running unlocked; in-process FIFO ordering; single execution of `fn` when `fn`
  itself throws `LockHeldError`; and the fail-open path — with a foreign holder
  in place and a shortened budget, assert `fn` still runs, exactly once, and
  that the loud `console.error` fired.
- `test/lib/git-concurrent-commit.doctest.md` — **the test that matters.**
  Spawn N real child processes (following `test/helpers/file-lock-child.ts`'s
  shape) that each `stageAndCommitPaths` a distinct file into one box at the
  same moment. Assert: N commits exist; each names only its own file; each
  message and trailer set matches its own writer; the working tree is clean; no
  writer errored. A single-process test cannot demonstrate this, per §10.
  Then the negative control: hold `.git/index.lock` directly past the budget and
  assert a bounded, typed `GitIndexLockError` carrying the token — not a hang.
- `test/lib/git-lock-recovery.doctest.md` — SIGKILL a holder mid-span and assert
  the next writer proceeds (via fail-open) rather than failing, and that it
  proceeds *before* the 5-minute stale window elapses. This is the regression
  test for the failure mode this design was corrected to avoid.

Done-when, as checkable assertions: those three doctests pass, `pnpm test` is
green, and `pnpm lint` / `pnpm typecheck` are clean.

**Knowledge-audit entries.** None, per the section above.

**Migration.** None. No on-disk shape changes. The lock file lives inside
`.git/`, is created on first use, and is removed on release; a box needs no
migration and an un-upgraded box is unaffected.

**Deploy sequencing.** Prod boxes run this code. The change is safe
half-deployed: an old writer that does not take the lock is a non-cooperating
writer, which the design already accommodates, and a new writer waits for it and
then proceeds. There is no ordering requirement between `bbx serve`, the
scheduler, and box hooks, and no step that needs the developer's hands beyond
the normal merge-to-`main` deploy.
