---
title: "Box pre-commit hooks point at a fixed checkout's bbx, breaking worktree schema development"
workstream: questions-end-to-end
area: beebox
filed-by: agent
discovered-in: worktree-questions-end-to-end — live-verifying a schema change against the worktree's test box
resolution: implemented
---

**Closed 2026-07-11:** root cause was narrower than filed — `worktree-create.sh`
already re-runs `bbx init` with the worktree's bbx (step 5), but `resolveCbBin()`
(`src/core/install-validation-hooks.ts:76`) detects it's running from a linked
worktree and deliberately rebases the embedded path back onto the MAIN checkout,
defeating the refresh. Fixed by setting `BBX_HOOK_BIN` (the existing escape hatch
built for exactly this) at that call site in `.claude/hooks/worktree-create.sh`.
No engine changes; prod-box behavior untouched. Verified live: the fix-bugs
test-box clone's hook now embeds the worktree's own `bin/bbx`.

A box's `.git/hooks/pre-commit` (installed by `bbx init`) invokes a hardcoded
`bbx` path — in the observed case the `main` checkout's
`~/src/beebox/bin/bbx`, whose built `dist/cli.mjs` predates
in-flight schema changes. Consequence: a worktree session that adds a schema
field or enum value (here: the `dismissed` question status) cannot commit
cards using it in its own test-box clone — `bbx validate --staged` runs the
stale binary and rejects the card, and the failure surfaces as a silent
write-then-rollback inside higher-level commands.

Observed during questions-end-to-end Track C verification; worked around by
temporarily repointing the box's hook at the worktree's `bin/bbx`, then
reverting.

Possible directions (unsettled): the worktree-clone hook (`bin/` worktree
tooling) could rewrite the hook to the worktree's own `bbx` when cloning the
test box; or the hook could resolve `bbx` relative to an env var the dev
router/session sets; or `bbx init` on a clone could re-derive the path. Each
has drift risks for prod boxes, which genuinely should pin a deployed `bbx`.
