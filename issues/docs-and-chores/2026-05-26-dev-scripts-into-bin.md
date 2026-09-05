---
title: "dev scripts into bin"
workstream: unknown
area: monorepo
priority: important
---

The worktree-tooling instance of this is now **implemented** (2026-08,
`worktree-worktree-seam`): [the worktree control surface
plan](../../beebox/docs/plans/worktree-control-surface.md) promoted
`.claude/hooks/worktree-create.sh`/`worktree-remove.sh` into `bin/workstreams`
subcommands for exactly the reason below — a hook path claims the logic
belongs to one agent frontend. That work applied the principle to worktree
tooling only. The broader `pnpm exec` audit across other scripts, READMEs, and
CLAUDE.md files is still untouched and stays open here.

`bin/` is the brand for the project's first-class dev tools — `bin/browse`, `bin/workstreams`, `bin/bbx`. Anything an agent or developer reaches for regularly should live there as a thin wrapper, not be invoked via `pnpm exec <tool>`. A local path (`bin/foo`) tells the agent "this is ours, look at the source if you need to understand it"; `pnpm exec foo` looks like an upstream tool with no local affordances. Audit `pnpm exec` invocations across scripts, READMEs, and CLAUDE.md files — anything used more than once or twice is a candidate to pull out.
