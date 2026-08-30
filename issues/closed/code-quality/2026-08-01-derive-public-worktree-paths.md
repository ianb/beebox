---
title: "Public worktree tooling hardcodes ~/src/… paths; derive like private-issues does"
workstream: streams-and-issues
area: router
filed-by: agent
discovered-in: worktree-private-issues — while building the private-issues shadow repo
design: ../../../beebox/docs/plans/worktree-control-surface.md
resolution: implemented
---

> **Resolved in `b1eafe78`.** The final orphan-report and orphan-sweep callers
> now obtain the public worktree root from `worktree-paths.sh`, including the
> `BBX_WORKTREE_ROOT` override. An isolated doctest covers a non-default
> root.

> **Mostly resolved 2026-08 in `worktree-worktree-seam`.** The new
> `bin/lib/worktree-paths.sh` (`wt_paths_init`) now covers the
> WorktreeCreate/Remove hooks, `session-end.sh`, `bin/workstreams sweep`, and
> `bin/launch-worktree-session` — the first three bullets below are done.
> **Still outstanding:** the fourth bullet, `bin/private-issues
> cmd_report_orphans`'s `beebox-worktrees` sibling-basename assumption.
> Leaving this open for that one item rather than re-triaging from scratch.

> **Folded into a plan.** The derivation helper is Track A / chunk 1 of
> [the worktree control surface plan](../../../beebox/docs/plans/worktree-control-surface.md),
> which rewrites three of the four files listed below anyway. The tension that
> remains here is the fourth (`bin/private-issues`'s `beebox-worktrees`
> basename assumption) and the care the sweep demands.

The private-issues mechanism derives every location from the checkout
(`git rev-parse --git-common-dir` → peers of the main checkout; see
`bin/private-issues`), so it works for any developer wherever they keep
their clone. The PUBLIC worktree tooling predates that and hardcodes
`$HOME/src/…` throughout:

- `.claude/hooks/worktree-create.sh` — `~/src/beebox-worktrees`,
  `~/src/boxes/test1`, `~/src/box-worktrees`.
- `.claude/hooks/session-end.sh` — `$HOME/src/beebox-worktrees/*` cwd
  match, `MONO="$HOME/src/beebox"`, the transcript-path regex.
- `.claude/hooks/auto-sweep.sh` gate, `bin/workstreams sweep` roots.
- `bin/private-issues cmd_report_orphans` assumes the sibling dir name
  `beebox-worktrees` (it derives the parent, but not that basename).

A developer whose checkout lives elsewhere gets worktrees that silently
miss every lifecycle hook. The fix is the pattern `bin/private-issues`
already uses: one shared derivation helper, explicit checkout-path
anchors, no `$HOME` assumptions. The tension: these hooks are
incident-hardened (`bin/CLAUDE.md`), so a sweep of path changes needs the
same care as router lifecycle edits — not a quick find/replace.
