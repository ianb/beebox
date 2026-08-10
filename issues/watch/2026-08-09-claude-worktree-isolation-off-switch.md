---
title: "Watch for a Claude worktree-isolation off switch"
workstream: workstreams
area: tooling
design: ../../callback-box/docs/plans/workstreams.md
filed-by: agent
discovered-in: worktree-workstreams — reviewing the landing and router action boundaries
---

Claude Code's worktree isolation currently prevents a worker from using git
directly against the main checkout. That constraint is why `bin/land` resolves
and updates main outside the worktree, and why router actions delegate lifecycle
mutations to narrow local commands instead of treating the worktree process as
an unrestricted repository operator.

Watch [anthropics/claude-code#50109](https://github.com/anthropics/claude-code/issues/50109)
or its successor for a supported per-session or per-command isolation disable
flag. If one ships, revisit the architecture of `bin/land` and the
`/workstreams/` router actions. The goal is not automatically to remove the
current seams: first compare the new authority boundary and failure modes with
the explicit, auditable commands we have now.
