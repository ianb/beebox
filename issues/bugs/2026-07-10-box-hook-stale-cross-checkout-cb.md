---
title: "Box pre-commit hooks point at a fixed checkout's cb, breaking worktree schema development"
area: callback-box
filed-by: agent
discovered-in: worktree-questions-end-to-end — live-verifying a schema change against the worktree's test box
---

A box's `.git/hooks/pre-commit` (installed by `cb init`) invokes a hardcoded
`cb` path — in the observed case the `main` checkout's
`~/src/callback-box/callback-box/bin/cb`, whose built `dist/cli.mjs` predates
in-flight schema changes. Consequence: a worktree session that adds a schema
field or enum value (here: the `dismissed` question status) cannot commit
cards using it in its own test-box clone — `cb validate --staged` runs the
stale binary and rejects the card, and the failure surfaces as a silent
write-then-rollback inside higher-level commands.

Observed during questions-end-to-end Track C verification; worked around by
temporarily repointing the box's hook at the worktree's `bin/cb`, then
reverting.

Possible directions (unsettled): the worktree-clone hook (`bin/` worktree
tooling) could rewrite the hook to the worktree's own `cb` when cloning the
test box; or the hook could resolve `cb` relative to an env var the dev
router/session sets; or `cb init` on a clone could re-derive the path. Each
has drift risks for prod boxes, which genuinely should pin a deployed `cb`.
