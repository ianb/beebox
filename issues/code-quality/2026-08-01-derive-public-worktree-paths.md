---
title: "Public worktree tooling hardcodes ~/src/… paths; derive like private-issues does"
area: router
filed-by: agent
discovered-in: worktree-private-issues — while building the private-issues shadow repo
---

The private-issues mechanism derives every location from the checkout
(`git rev-parse --git-common-dir` → peers of the main checkout; see
`bin/private-issues`), so it works for any developer wherever they keep
their clone. The PUBLIC worktree tooling predates that and hardcodes
`$HOME/src/…` throughout:

- `.claude/hooks/worktree-create.sh` — `~/src/callback-worktrees`,
  `~/src/boxes/test1`, `~/src/box-worktrees`.
- `.claude/hooks/session-end.sh` — `$HOME/src/callback-worktrees/*` cwd
  match, `MONO="$HOME/src/callback-box"`, the transcript-path regex.
- `.claude/hooks/auto-sweep.sh` gate, `bin/worktrees sweep` roots.
- `bin/private-issues cmd_report_orphans` assumes the sibling dir name
  `callback-worktrees` (it derives the parent, but not that basename).

A developer whose checkout lives elsewhere gets worktrees that silently
miss every lifecycle hook. The fix is the pattern `bin/private-issues`
already uses: one shared derivation helper, explicit checkout-path
anchors, no `$HOME` assumptions. The tension: these hooks are
incident-hardened (`bin/CLAUDE.md`), so a sweep of path changes needs the
same care as router lifecycle edits — not a quick find/replace.
