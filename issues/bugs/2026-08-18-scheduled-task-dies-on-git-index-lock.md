---
title: "A scheduled task fails outright on `.git/index.lock` — the one-retry budget is too small for unattended work"
workstream: unattached
area: callback-box
labels: [scheduler, git, procedures]
filed-by: agent
discovered-by: agent
discovered-in: main session — investigating scheduled-task failures on a local box
---

A scheduled procedure failed with:

```
Command failed with exit code 1
stderr:
Error: fatal: Unable to create '<box>/.git/index.lock': File exists.
Another git process seems to be running in this repository
```

It died in 6.5 seconds, before doing any real work, and has now recorded four
consecutive failures. The task surfaces in `cb health` as a plain
`exit code 1`, which reads like the task is broken rather than like it lost a
lock race.

## This is a known, deliberate trade-off that is now visibly too thin

[git commit race audit](../closed/bugs/2026-07-05-git-commit-race-audit.md)
converted 33 sites to `stageAndCommitPaths` and closed with an explicit
decision:

> no process-wide mutex needed (cross-process same-path commits remain on the
> index-lock retry, recorded as deliberate) … currently retried once on lock
> collision by `cli/lib/git.ts`

**One retry.** That is a reasonable budget for two quick commits colliding. It
is not a reasonable budget for a *scheduled* task competing with whatever else
is writing to a box, because the competing holder may not be quick:

- an agent turn that stages and commits as part of its work
- `cb feedback`, which commits on every call (a rapid conversation produced a
  commit storm on 2026-08-14)
- an interactive session in the same box
- another scheduled task in the same tick

## Why the scheduled case deserves better than interactive code

- **Nobody is watching.** An interactive command that loses a lock race gets
  retried by a human within seconds. A scheduled one records a failure and
  waits for its next cadence — here, a day.
- **The failure is sticky and misattributed.** Four consecutive failures on a
  task whose actual code is fine. Anyone reading `cb health` starts debugging
  the procedure, not the lock.
- **The box is a shared mutable resource with many writers.** At least eight
  modules under `src/core/` commit to a box repo (`maps/finalize.ts`,
  `capture/prepare.ts`, `todo/review-sweep.ts`, `annex/to-annex.ts`,
  `scan/promote-questions.ts`, `finish-job.ts`, `notify-boxholder.ts`,
  `install-validation-hooks.ts`, …). Concurrency here is normal operation, not
  an edge case.

## Fix directions

- **Raise the retry budget where the caller is unattended** — bounded backoff
  rather than a single immediate retry. Smallest change, and it addresses the
  observed failure directly.
- **Serialize box-repo writes through the existing lock.**
  `src/lib/file-lock.ts` (on `proper-lockfile`, with stale/crash recovery) is
  already the house mechanism for cross-process locks and is not used for box
  git operations. The closed audit judged a mutex unnecessary; that judgment
  predates this evidence and is worth revisiting rather than assumed.
- **Distinguish "lost a lock race" from "the task failed" in health.** A task
  that never ran is not a task that ran and broke, and the scheduler currently
  reports both as `exit code 1`. Compare
  [health masks a review-step turn cap](2026-08-12-health-masks-review-step-turn-cap.md),
  which is the same complaint about a different collapsed distinction.

## Note on scope

Found while investigating scheduled failures on a box that had recently
switched its `agentEngine` to Codex. This one is **not** engine-related — it
fails before any agent runs and would fail identically on any engine. A
sibling failure on the same box (an agent exec exiting 1) may well be
engine-related; they should not be treated as one problem.
