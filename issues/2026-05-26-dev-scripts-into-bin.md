---
area: monorepo
---

# Move more dev scripts from `pnpm exec` into `bin/`

`bin/` is the brand for the project's first-class dev tools — `bin/browse`, `bin/worktrees`, `bin/cb`. Anything an agent or developer reaches for regularly should live there as a thin wrapper, not be invoked via `pnpm exec <tool>`. A local path (`bin/foo`) tells the agent "this is ours, look at the source if you need to understand it"; `pnpm exec foo` looks like an upstream tool with no local affordances. Audit `pnpm exec` invocations across scripts, READMEs, and CLAUDE.md files — anything used more than once or twice is a candidate to pull out.
