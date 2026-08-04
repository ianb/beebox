---
title: "Codex workers can't commit/finish in a linked worktree (upstream sandbox limitation)"
area: callback-box
filed-by: agent
discovered-in: main session — a codex worker's commit hit EPERM despite the parity grant
labels: [codex-worktrees]
---

**Upstream trigger to watch:** [openai/codex#14338](https://github.com/openai/codex/issues/14338)
("Allow writable gitdir for the current worktree in sandboxed workspace-write mode")
and [#23661](https://github.com/openai/codex/issues/23661) (linked-worktree
`index.lock` read-only despite `--add-dir`). Re-check this item when codex ships
the requested opt-in flag / config to relax the `.git` carve-out for the current
worktree.

## The limitation

A codex worker runs in a `workspace-write` sandbox. Codex **force-mounts `.git`
and the resolved gitdir read-only *after* the writable roots are applied**, so the
read-only mount always wins — no `--add-dir` grant can make git metadata writable
(stated by the codex maintainers' own issue). For a **linked git worktree** it is
worse: the worktree's git metadata lives *outside* the worktree at
`$MONO/.git/worktrees/<name>`, so even granting the whole main checkout does
nothing. Verified 2026-08-04: a worker launched *after* an `--add-dir "$MONO"`
grant still failed with `Unable to create '…/.git/worktrees/<name>/index.lock':
Operation not permitted`.

That ineffective `--add-dir "$MONO"` grant (+ private-issues writable paths) was
reverted — it delivered nothing and only weakened isolation.

## Current working model (documented in `bin/CLAUDE.md`)

**Codex implements + verifies + reports; the parent (a Claude session or the
boxholder) commits and lands.** This has worked cleanly twice (annex-trash-remnants,
history-blob-url-encoding). The merge-to-main step is unsandboxable for codex
*regardless* of any local-commit fix, because it writes the shared main checkout's
`.git`.

## If/when we want autonomous codex commits — options (not yet chosen)

- **Out-of-sandbox commit broker.** The launcher starts an unsandboxed helper
  beside codex; codex drops a `.commit-request` sentinel (message + paths) in its
  workspace (writable), the broker commits in the worktree. Keeps the strict
  sandbox; codex gets autonomous checkpointing. Custom machinery + a trust boundary
  on the sentinel. Same broker could run `/finish`.
- **Standalone clone instead of a linked worktree.** Codex's `.git` would be
  self-contained inside the workspace (writable), so *commits* work under the
  strict sandbox — but *landing on main* still needs an unsandboxed actor (writing
  the shared main `.git`), and it diverges codex's path from the linked-worktree
  model the dev router / sweep / box-clones assume.
- **`danger-full-access`** — rejected: removes sandboxing entirely, against the
  strict-sandbox preference.
- **Approval escalation (`-a on-request`)** — codex can retry a sandbox-failed
  command unsandboxed *with approval*, but autonomous sessions have no approver.

## Related

- `callback-box/docs/implemented-plans/codex-worktree-sessions.md` — the feature.
- `bin/CLAUDE.md` "Codex worktree sessions" — documents the parent-lands model.
