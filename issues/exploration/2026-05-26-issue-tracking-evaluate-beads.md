---
title: "issue tracking evaluate beads"
workstream: unknown
needs: [decision]
area: monorepo
---

This top-level `issues/` tree (one `YYYY-MM-DD-slug.md` file per item, which replaced a single giant `ideas.md`) plus scattered TODOs across the monorepo is the current state of issue tracking. One-file-per-item already fixed the every-session-loads-the-whole-file problem, but the rest of the weaknesses this entry originally called out still apply: no dependency graph, no "what's ready to pick up next" query, parallel worktrees can't safely claim work, closed items (moved to `issues/closed/`) don't fold into a summary.

[Beads](https://github.com/steveyegge/beads) (Steve Yegge, late 2025) is the most-developed entrant in the "issue tracker designed for coding agents" space. Shape: a `bd` CLI backed by Dolt (SQL with git-style branching) in `.beads/`, with a JSONL changelog at `.beads/issues.jsonl` that's the git-tracked, human-diffable layer. Distinctive bits for agent workflows:

- `bd ready` returns only unblocked leaves of the dependency graph — the agent gets actionable work without loading the whole plan.
- `bd update <id> --claim` is atomic assign+start, so two worktrees can't race the same task.
- Typed dependencies (`blocks`, `parent-child`, `discovered-from`, `supersedes`).
- Hash-based IDs (`bd-a1b2`) that don't collide on parallel creation.
- `bd remember` / `bd prime` build a persistent project knowledge base injected at session start; closed-issue summaries fold in.
- `bd setup claude` wires the harness.

Fits the existing infrastructure surprisingly well: the `WorktreeCreate` hook already runs setup per worktree, so a `bd ready` call at session start is a natural extension. Per-subproject scoping via labels (`beebox`, `cardworks`, `clerk`, `agent-doctest`).

Costs to weigh: another binary + daemon (tension with "noisy output is a bug"); JSONL churn in commits; lock-in to Dolt's storage; the convention of treating closed issues as memory rather than archive is a behavior change for the user, not just the agent. The casual alternative (gstack's single `TODOS.md` with a strict What/Why/Effort/Priority/Depends-on template enforced by a skill) gives up dependency queries and parallel-agent safety but keeps zero deps.

Probably too many new things to introduce at once — capability map, memory-writing guidance, user-model dimensions, hot-context, and *also* a tracker rewrite is a lot. Worth a feel-out pass first: keep watching how the current `issues/` tree + per-area TODOs actually fail before committing to a tool. Decision trigger: the first time two worktrees want the same task, or the first time "what should I work on next" requires more than skimming the directory.
