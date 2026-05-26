## Monorepo Layout

Four projects live in one git repository (previously three independent repos, merged 2026-05):

- **callback-box/** — Main system. See its CLAUDE.md for details.
- **callback-clerk/** — Chrome extension that talks to a hosted callback-box instance.
- **cardworks/** — XML card library (parsing, validation, JSX). Used by callback-box (consumed via `file:../cardworks` symlink in `callback-box/node_modules/`).
- **agent-doctest/** — Doctest framework extracted from callback-box.

**Boxes** live at `~/src/boxes/` (outside this repo so agents don't inherit this CLAUDE.md). `~/src/boxes/test1/` is the primary test box.

**Worktrees** — use `git worktree add ../callback-mono-<name>` for parallel experiments. Note that `~/src/boxes/` is shared across worktrees; coordinate or use different test boxes if running parallel agents that mutate box state.
