---
title: "Post-commit deploy fails hard on a transient worktree index.lock (ENOTDIR) instead of retrying"
area: callback-box
filed-by: agent
discovered-in: main session — while deploying a frontend image-card fix (commit e0a788a7)
---

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
