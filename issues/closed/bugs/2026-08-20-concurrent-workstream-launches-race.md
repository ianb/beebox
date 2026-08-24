---
title: "Concurrent workstream launches race in git worktree add"
workstream: streams-and-issues
design: ../../../callback-box/docs/plans/concurrent-workstream-creation.md
area: router
labels: [workstreams, lifecycle, concurrency]
resolution: implemented
filed-by: agent
discovered-by: agent
discovered-in: main clerical session — launching several routed workstreams
---

Launching several `bin/launch-worktree-session` commands concurrently can make
their `git worktree add` operations collide. Some launches then fail after a
Terminal tab has opened, leaving that session in an invalid working directory.

`bin/lib/worktree-create.sh` checks whether the worktree or branch already
exists and then runs `git worktree add`, but the check and mutation are not a
serialized critical section. The user-facing skill currently needs to say
“launch one at a time” even though the independent work appears parallelizable.

A likely fix is a repository-scoped lock around only the check plus `git
worktree add`, with state re-checked after lock acquisition. Installs and agent
launches should remain outside it. This needs a concurrent creation test before
the workflow guidance permits parallel launching.

## Resolution

Managed creation now uses kernel-owned advisory locks: one per repository for
Git worktree attachment and one per name for complete setup readiness. A
per-name `in-progress`/`ready` state makes interrupted setup retryable without
reinstalling or overwriting legacy worktrees on their first resume. Managed
teardown uses the same locks and refuses immediately when setup is active so it
cannot act on stale safety evidence; Claude's native removal adapter protects
satellites and leaves a pending-removal tombstone across its external Git step.

A disposable 24-way negative control reproduced the original corruption (one
checkout registered on `main`, then a later add tried to create `main`). The
focused doctest covers same-name waiting, different-name parallel setup, a
24-way branch-integrity burst, setup failure/retry, setup-vs-removal refusal,
legacy backfill, dangling-registration recovery, native-removal tombstones,
timeout, and killed-holder release. Cross-model review drove failure-path,
teardown, legacy-state, and native-removal hardening before closure.

Related but distinct: [the pre-agent liveness gap](2026-08-20-workstream-launch-liveness-gap.md).
