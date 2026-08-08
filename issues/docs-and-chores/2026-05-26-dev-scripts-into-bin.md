---
title: "dev scripts into bin"
area: monorepo
---

The worktree-tooling instance of this is now planned separately:
[the worktree control surface plan](../../callback-box/docs/plans/worktree-control-surface.md)
promotes `.claude/hooks/worktree-create.sh` into `bin/worktrees create` for
exactly the reason below — a hook path claims the logic belongs to one agent
frontend. The broader `pnpm exec` audit is still open here.

`bin/` is the brand for the project's first-class dev tools — `bin/browse`, `bin/worktrees`, `bin/cb`. Anything an agent or developer reaches for regularly should live there as a thin wrapper, not be invoked via `pnpm exec <tool>`. A local path (`bin/foo`) tells the agent "this is ours, look at the source if you need to understand it"; `pnpm exec foo` looks like an upstream tool with no local affordances. Audit `pnpm exec` invocations across scripts, READMEs, and CLAUDE.md files — anything used more than once or twice is a candidate to pull out.
