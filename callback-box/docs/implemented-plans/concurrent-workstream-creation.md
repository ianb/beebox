---
title: "Serialize Git worktree attachment during concurrent launches"
status: implemented
workstream: streams-and-issues
issues:
  - ../../../issues/closed/bugs/2026-08-20-concurrent-workstream-launches-race.md
---

# Serialize Git worktree attachment during concurrent launches

Concurrent workstream launches should queue only around Git's shared worktree
administration. Once a checkout is attached, box cloning, dependency installs,
agent-document generation, and Terminal launch remain parallel.

## Stated preferences this plan trades against

- Engineering principle 8 requires one implementation of an operation. Every
  frontend already reaches `wt_create` through `bin/workstreams create`; the
  lock belongs in that shared library, not in either launcher.
- Engineering principle 10 treats testability as architecture. The critical
  section becomes a small function that can be driven against a scratch Git
  repository without cloning a box or installing dependencies.
- The issue asks for parallelizable independent work. A repository-wide lock
  around the whole `wt_create` function would be correct but would serialize
  the expensive independent setup. The lock is deliberately narrower.
- Routine launch output should stay quiet. Uncontended lock acquisition emits
  nothing; timeout or broken lock metadata is an actionable error on stderr.

## What already exists

- `bin/lib/worktree-create.sh:132-154` checks the registered worktree list,
  checks whether `worktree-<name>` exists, and then runs `git worktree add`.
  Those reads and the mutation are currently one unprotected check-then-act
  sequence.
- The same function continues with box cloning and installation from line 164
  onward. Those operations use per-name destinations and do not need the Git
  administration lock.
- `bin/lib/worktree-paths.sh:35` derives one shared `WT_STATE_DIR`, but the lock
  is specifically repository-scoped. Git's absolute common directory is the
  stable identity shared by main and all linked worktrees.
- The launcher runs on macOS, where `lockf` provides a kernel-owned advisory
  lock, while Linux CI provides `flock`. Both release automatically when a
  holder exits or is killed, avoiding PID-reuse and stale-reclaim races.
- `bin/workstreams create` owns the one-line stdout contract documented in
  `bin/CLAUDE.md:255`; lock diagnostics must stay on stderr.

## Track A — Extract the Git attachment transaction

Add `wt_create_attach_worktree <name> <base-ref> <path> <branch>`. It sets
`WT_CREATE_REUSED=true|false` and performs exactly the current three-way
decision:

1. registered path exists: mark reused and return;
2. branch exists: attach it without `-b`;
3. otherwise: create the branch and attach with `-b`.

The function acquires the repository lock before the first read and releases it
after the add or any error. The repository lock is also used around teardown's
worktree move/prune/branch-delete transaction, so create and remove do not race
through the same Git administrative state. Managed teardown tries the per-name
lock without waiting: contention invalidates the caller's pre-lock safety
snapshot, so it refuses and requires a fresh retry after setup finishes.

`wt_create` additionally takes a per-name setup lock before attachment and
holds it through the final setup step. Without that second lock, a same-name
loser can see the winner's newly registered checkout and return while the
winner is still installing it. Different names remain parallel after their
brief Git attachment transactions. A per-name state file in the Git common
directory is written `in-progress` before a fresh add and `ready` only after
setup succeeds. This distinguishes a post-rollout interrupted checkout from a
legacy checkout, whose missing state is backfilled without overwriting its
possibly-divergent `.env` or reinstalling it.

This extraction makes the transaction testable without a production-only skip
flag and keeps `git worktree add` in one implementation.

## Track B — Add bounded kernel-owned locks

Lock files live in the absolute Git common directory, the stable identity shared
by main and every linked checkout. One file protects repository-wide worktree
administration; a sanitized per-name file protects setup readiness.

Acquisition opens each persistent lock file using `lockf` on macOS or `flock`
on Linux. The file itself is never evidence of an owner; only the kernel lock
is. Process exit and signals release it without a manual stale-recovery
protocol. Git administration waits at most 120 seconds; complete same-name
setup waits at most 30 minutes. A live owner that exceeds its budget produces a
clear nonzero timeout. A platform with neither tool fails explicitly instead
of running the Git mutation unlocked.

Fallible setup bodies are invoked as bare commands so the production caller's
errexit/ERR trap remains active; putting a function in a conditional suppresses
errexit throughout its body in Bash. Normal success closes the descriptor
explicitly, while abrupt failure or process death is handled by the kernel.

## Track C — Prove contention and update guidance

Add `worktree-create-concurrency.doctest.md` with a scratch Git repository and a
stub `pnpm`. The first same-name creator reaches a readiness marker inside its
post-attachment setup and waits for release. A second creator must still be
running until that release, then reuse the fully configured checkout. The same
test starts different-name creators and proves both reach setup concurrently
after their serialized attachment. A many-name burst verifies every checkout's
registered branch, covering the exact corruption reproduced before the fix
(`parallel-14` registered on `main`, followed by `parallel-21` failing because
Git tried to create `main`). A production-shell failure injection proves a
failed install remains incomplete and retryable rather than being marked ready.

Update `bin/CLAUDE.md` and the launch-worktree skill to say concurrent launches
are supported and only Git attachment queues. Remove any remaining “one at a
time” workaround if present.

## Failure modes

| Failure | Test | Handling | Visibility |
| --- | --- | --- | --- |
| Two callers create the same name | Same-name contention doctest | One add; loser waits for ready setup and reuses | Both succeed |
| Two callers create different names | Different-name contention doctest | Adds queue; later setup remains parallel | Both succeed |
| Managed teardown overlaps same-name setup | Create/remove contention doctest | Removal refuses immediately; retry uses fresh safety evidence | Checkout survives until retry |
| `git worktree add` fails | Helper doctest | Release lock and return Git status | Git stderr + nonzero |
| Owner dies while holding lock | Kill-holder doctest | Kernel releases descriptor lock | Next caller succeeds |
| Live owner is wedged | Explicit-clock/short-budget helper test | Bounded timeout | Named lock path and owner PID |
| Caller is killed after add before unlock | Kill-holder recovery test | Kernel releases; next caller re-checks registration | Reuse, not second add |

## Agent-flow and user-flow edge cases

- **Same name, different base refs:** the first successful attachment wins, as
  it does for sequential idempotent creates today. The loser reuses that path;
  it does not silently move the branch.
- **Branch already exists but is attached elsewhere:** Git remains the
  authority and returns its existing clear error. The lock does not detach or
  relocate another checkout.
- **A directory exists but is not Git-registered:** current behavior is
  preserved: Git refuses the add. This plan does not delete or adopt it.
- **Concurrent cleanup:** removal uses the same repository-wide lock across its
  worktree move, prune, and branch decision, and the same per-name setup lock
  across the whole teardown. A contended managed removal refuses instead of
  waiting on stale liveness/git evidence. Claude Code's native worktree removal
  is outside repo control; its adapter holds the per-name lock while cleaning
  satellites and leaves a pending-removal tombstone so same-name create refuses
  until Claude's Git removal lands. Concurrent managed creates are supported;
  mixing them with native Claude removal is not promised.
- **Launch lease interaction:** each Terminal attempt owns its existing token.
  Waiting for the Git lock remains inside the bounded launch lease and is
  visible as `launching`.

## Not in scope

- Serializing box clones, installs, agent-guide generation, or Terminal
  automation.
- Changing Git's same-name/idempotent winner semantics.
- Replacing unrelated application or registry locks; this helper is scoped to
  worktree lifecycle and has a deliberately longer budget.
- Remote/distributed locking. All managed worktree creation is local to one Git
  common directory.
- Supporting a custom `--path` whose basename differs from the workstream name;
  lifecycle state and satellite ownership are name-keyed, so this is refused.

## Open questions

There are no product decisions. The implementation should first run the
contention probe against the current code to confirm it can produce the
collision before making it green.

## Done when

- The disposable-clone negative control records the pre-fix branch corruption;
  the concurrency doctest proves same-name readiness, different-name setup
  overlap, production-shell failure/retry, and a many-name branch-integrity
  burst through the shared helper.
- The lock is held only across list/show-ref/add and releases on every returned
  error.
- Existing launch, resume, comments-mount, and worktree lifecycle doctests pass.
- Root typecheck/lint, callback-box doc-check, and `git diff --check` pass.
- Independent cross-model review has no unresolved material lifecycle finding.
