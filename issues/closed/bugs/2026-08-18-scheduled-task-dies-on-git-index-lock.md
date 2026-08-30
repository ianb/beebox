---
title: "A scheduled task fails outright on `.git/index.lock` — the one-retry budget is too small for unattended work"
workstream: box-git-lock
area: beebox
labels: [scheduler, git, procedures]
filed-by: agent
discovered-by: agent
discovered-in: main session — investigating scheduled-task failures on a local box
resolution: implemented
---

Closed by `worktree-box-git-lock`, landed through commit `3a0e88a3` (branch tip;
see `docs/implemented-plans/box-git-lock.md` for the full plan). `withBoxGitLock`
(`src/lib/git-lock.ts`) now serializes every in-repo git-index mutator and holds
one lock across each multi-operation span (structural fix parts 1 and 2). `bbx
health` distinguishes a lost lock race from a broken task ("Also worth fixing").
Part 3 (deferring scheduled work on the active-chats signal) was deliberately
**not** implemented — the plan's "NOT in scope" section explains why: it's
already built for the case it fits, and it would not have prevented this
specific failure, which arose mid-run rather than pre-run. Part 4 (commit less
casually) shipped only for `bbx feedback` (one span instead of two); broader
commit-volume reduction is explicitly out of scope. This also resolves the
Track H deferral recorded in the already-closed
[git commit race audit](2026-07-05-git-commit-race-audit.md).

A scheduled procedure failed with:

```
Command failed with exit code 1
stderr:
Error: fatal: Unable to create '<box>/.git/index.lock': File exists.
Another git process seems to be running in this repository
```

It died in 6.5 seconds, before doing any real work, and has now recorded four
consecutive failures. The task surfaces in `bbx health` as a plain
`exit code 1`, which reads like the task is broken rather than like it lost a
lock race.

## This is a known, deliberate trade-off that is now visibly too thin

[git commit race audit](2026-07-05-git-commit-race-audit.md)
converted 33 sites to `stageAndCommitPaths` and closed with an explicit
decision:

> no process-wide mutex needed (cross-process same-path commits remain on the
> index-lock retry, recorded as deliberate) … currently retried once on lock
> collision by `cli/lib/git.ts`

**One retry.** That is a reasonable budget for two quick commits colliding. It
is not a reasonable budget for a *scheduled* task competing with whatever else
is writing to a box, because the competing holder may not be quick:

- an agent turn that stages and commits as part of its work
- `bbx feedback`, which commits on every call (a rapid conversation produced a
  commit storm on 2026-08-14)
- an interactive session in the same box
- another scheduled task in the same tick

## Why the scheduled case deserves better than interactive code

- **Nobody is watching.** An interactive command that loses a lock race gets
  retried by a human within seconds. A scheduled one records a failure and
  waits for its next cadence — here, a day.
- **The failure is sticky and misattributed.** Four consecutive failures on a
  task whose actual code is fine. Anyone reading `bbx health` starts debugging
  the procedure, not the lock.
- **The box is a shared mutable resource with many writers.** At least eight
  modules under `src/core/` commit to a box repo (`maps/finalize.ts`,
  `capture/prepare.ts`, `todo/review-sweep.ts`, `annex/to-annex.ts`,
  `scan/promote-questions.ts`, `finish-job.ts`, `notify-boxholder.ts`,
  `install-validation-hooks.ts`, …). Concurrency here is normal operation, not
  an edge case.

## The structural fix

The framing that matters: **git's index is a single repo-wide mutex, and we
treat commits as independent per-path operations.** `stageAndCommitPaths` made
commits path-*scoped*, which fixed attribution — which changes land together —
but did nothing about concurrency, because only one process can hold
`.git/index.lock` no matter how narrow its pathspec. Retrying is a way of
pretending the mutex isn't there.

Both pieces of the real answer already exist in this codebase, applied to other
resources:

**1. Hold a lock across the whole stage-and-commit span.**
`stageAndCommitPaths` (`src/lib/git.ts:309`) is already the single door every
in-repo writer goes through. Wrapping its body in `src/lib/file-lock.ts` (on
`proper-lockfile`, with mtime-freshness stale recovery — the house mechanism
for exactly this) turns contention into *queueing* instead of failure.

This also closes a defect the closed audit explicitly deferred rather than
solved. Its Track H note: `stageFiles` + `commit` are "two non-atomic git ops
sharing one `.git/index.lock`", so two mutations on *different* files can
interleave staging and get co-committed under the wrong attribution. One lock
around the span fixes the contention and that interleaving together — they are
the same bug seen from two sides.

**2. Wait, then fail — and mean it.** A bounded wait distinguishes "another
process is committing" (normal, wait for it) from "something is wedged" (real,
report it). Today those are the same immediate error. The one-retry budget is
not a smaller version of this; it is a different thing that happens to
sometimes work.

**3. Defer unattended work instead of racing it.** The precedent is right
there: chat sessions take a lock under `.beebox/active-chats/` precisely
so "other processes (notably `bbx tick`) can detect a chat is actively producing
a response and defer housekeeping work that would otherwise race with
mid-response writes" (`src/core/schedule/state.ts:283-289`). That is this exact
problem, already recognised and solved — for one writer. A scheduled task that
commits should defer on the same signal.

**4. Commit less casually.** Contention is proportional to commit count, and
several paths commit per *event* rather than per unit of work — `bbx feedback`
commits on every call, which produced an observed commit storm on 2026-08-14.
Batching those is a reduction in the problem rather than a mitigation of it.

### The limit worth stating

**Box agents shell out to raw `git` and cannot be made to take the lock.** A
wrapped command they are told to use is possible, but it is guidance, not a
guarantee. That is survivable, and it is why the lock belongs on *our* writers
rather than only on the agent's: locking our side does not stop an agent from
holding the index, but it makes every one of our writers **wait** for it rather
than die. The unlockable writer is exactly the one the others must be patient
with.

## Also worth fixing

**Distinguish "lost a lock race" from "the task failed" in health.** A task that
never ran is not a task that ran and broke, and the scheduler reports both as
`exit code 1`. Compare
[health masks a review-step turn cap](2026-08-12-health-masks-review-step-turn-cap.md),
the same complaint about a different collapsed distinction.

The *deferred-recoverable* sibling of this distinction now exists: engine
quota exhaustion records a `deferred` outcome (freezing `consecutiveFailures`)
and renders as `waiting` in `bbx health`
(`../closed/bugs/2026-08-18-codex-quota-exhaustion-surfaces-as-a-meaningless-error.md`,
design in `../../beebox/docs/plans/deferred-recoverable-agent-failures.md`
— which reserves the **transient** vocabulary this issue owns: retry-now
failures like this lock race, distinct from retry-later and permanent).

## Note on scope

Found while investigating scheduled failures on a box that had recently
switched its `agentEngine` to Codex. This one is **not** engine-related — it
fails before any agent runs and would fail identically on any engine. A
sibling failure on the same box (an agent exec exiting 1) may well be
engine-related; they should not be treated as one problem.
