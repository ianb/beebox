---
title: "Post-commit deploy fails hard on a transient worktree index.lock (ENOTDIR) instead of retrying"
area: callback-box
filed-by: agent
discovered-in: main session — while deploying a frontend image-card fix (commit e0a788a7)
resolution: implemented
---

**Resolved** (worktree `fix-bugs`, 2026-07-11): factored a `recreate_checkout()`
helper out of the duplicated wipe+`worktree prune`+`worktree add` recreate logic,
then wrapped both the bare `git -C "$CHECKOUT" checkout --detach "$SHA"` and
`git -C "$CHECKOUT" clean -fdx ...` in retry-once-then-recreate handling
(`callback-box/deploy/deploy.sh:203-252`). A transient failure now gets a 2s
sleep + one retry; a second failure falls back to the existing wipe/recreate
path instead of exiting fatally. A `CHECKOUT_FRESH` flag skips the `clean` step
entirely when the checkout was just (re)created (a fresh worktree has nothing
to clean). The settle/serialize idea (third bullet in the original list) was
not pursued — the retry/recreate handling covers the failure mode without it.

**Follow-up fix** (main session, 2026-07-11): the first fix left a gap AND
misdiagnosed the cause. The gap: it hardened `checkout --detach`/`clean` but not
`recreate_checkout()`'s own `git worktree add`, which died next (`Preparing
worktree … fatal: .git/index: … Not a directory`). The real cause: **a
concurrent-`git worktree add` race** — the deploy's worktree creation collides
with a worktree *session* being spun up at the same moment (confirmed: two new
worktrees registered within seconds of a failing deploy, and the same
`worktree add` succeeded on a manual retry moments later). Git serializes on its
shared `.git/index`/`index.lock`, and overlapping worktree ops ENOTDIR each
other; the window can span ~10s when several creates overlap, so a 2×2s retry
lost the race twice.

Fix: a `run_with_backoff` helper wraps every deploy-checkout git op
(`checkout --detach`, `clean`, and the `worktree add` inside `recreate`) with a
0/2/4/8/16/30s backoff (~60s budget) so it outlasts the contended window before
declaring a non-transient failure. `checkout --detach`/`clean` ride out the
transient IN PLACE (retrying) before falling back to a recreate, since recreate
wipes node_modules and forces a slow reinstall. `recreate_checkout()` also
scrubs any worktree-metadata dir whose `gitdir` points at the checkout (curing a
prune-resistant corrupt registration). Verified in isolation: fresh create,
self-heal after a stale registration, and riding out a fail-once-then-succeed
transient. A deeper fix (a shared lock serializing deploy's worktree ops against
the WorktreeCreate hook) was considered but not taken — no `flock` on macOS, and
the backoff covers the observed window; revisit if it recurs.

**Definitive fix** (main session, 2026-07-11): it recurred, harder, and the
backoff/self-heal/lock attempts all failed because they treated symptoms. The
real cause is structural: **`.deploy-checkout` was a git *worktree*, so it
shared the main repo's `.git/worktrees/` bookkeeping that every concurrent
worktree op mutates** — worktree sessions spinning up, cleanup hooks,
`bin/workstreams sweep`, and (unlockable) Claude Code's own `git worktree remove`
on session exit. A shared `mkdir` lock was tried and STILL failed: `core.hooksPath`
is relative (`.husky/_`), so the pre-existing worktree sessions run their OWN
old, unlocked hooks — a lock in the current checkout can't cover them, nor
Claude Code's built-in worktree removal.

The fix: **stop using a git worktree for the build checkout.** It's now a
standalone local `git clone --shared` (`callback-box/deploy/deploy.sh`) — its own
`.git` dir, so it's invisible to `git worktree` ops and *cannot* be corrupted by
any of the above. `--shared` points its object store at the main repo via
alternates, so a just-committed `$SHA` checks out with no fetch and no object
copy (measured: 0.04s to create the clone), and node_modules persists across
deploys. `checkout_belongs_to_repo` now validates the clone's alternates instead
of a worktree gitdir. All the worktree-specific machinery (backoff, recreate,
scrub) and the shared lock (`bin/git-worktree-lock.sh` + its hook wiring) were
removed — the clone makes them unnecessary. Verified in isolation: fast create,
sha checkout without fetch, clean preserving node_modules, and invisibility to a
concurrent `git worktree prune`.

The `post-merge` auto-sweep is still removed (worktree cleanup runs on
SessionStart) — good hygiene, though the clone no longer needs it gone.

The root `post-commit` hook backgrounds `callback-box/deploy/deploy.sh --ref <sha>`
the instant a `main` commit completes. On one deploy the build-checkout step
died immediately:

```
Deploying ref 'e0a788a7' … from build checkout …/.deploy-checkout
fatal: Unable to create '…/.deploy-checkout/.git/index.lock': Not a directory
Deploy failed (exit 128)
```

`.deploy-checkout` is a detached git worktree; its `.git` is a normal gitlink
*file*. The ENOTDIR ("Not a directory") means some git op momentarily treated
`.git` as a real directory and tried to write `.git/index.lock` literally — a
worktree writes its index at `$COMMON_DIR/worktrees/<name>/index`, not there.
It was **transient**: seconds later `git -C .deploy-checkout status` and the
exact failing `git -C .deploy-checkout checkout --detach <sha>` both succeeded,
and a manual `deploy.sh --ref <sha>` re-run deployed cleanly. Most likely a race
between git's worktree bookkeeping and the just-finished `git commit` (the hook
fires from inside the commit's tail; a killed-then-retried commit was also in
play this session).

The failure mode that matters: **on `main`, auto-deploy is the only path to
prod, and this fails to only a `terminal-notifier` toast + a log line** — the
boxholder can easily miss it and think a fix shipped when it didn't. A prod
deploy shouldn't be defeated by a self-healing transient.

`deploy.sh` already treats the checkout as a disposable cache and has a
`checkout_belongs_to_repo` guard that wipes+recreates (`deploy/deploy.sh:204`),
but that guard didn't catch this (the worktree *did* belong to the repo; only a
git op transiently failed). Candidate hardening (git-push-deploy owns this area):

- Retry the `git -C "$CHECKOUT" checkout --detach "$SHA"` once (and/or the
  `clean -fdx`) on failure before giving up — `deploy/deploy.sh:215`, `:223`.
- On any git failure in the checkout-prep block, fall back to the existing
  wipe+`worktree prune`+`worktree add` recreate path (`deploy/deploy.sh:207-209`)
  rather than exiting 128.
- Consider a short settle/serialize so the backgrounded deploy doesn't race the
  commit that spawned it (the post-commit hook, `.husky/post-commit`).

Not reproduced deterministically — the fix is defensive (retry/recreate on the
narrow git-op failure), not a hunt for the exact race.
