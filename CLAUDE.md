## Monorepo Layout

Four projects live in one git repository (previously three independent repos, merged 2026-05):

- **callback-box/** — Main system. See its CLAUDE.md for details.
- **callback-clerk/** — Chrome extension that talks to a hosted callback-box instance.
- **cardworks/** — XML card library (parsing, validation, JSX). Used by callback-box (consumed via `file:../cardworks` symlink in `callback-box/node_modules/`).
- **agent-doctest/** — Doctest framework extracted from callback-box.

**Boxes** live at `~/src/boxes/` (outside this repo so agents don't inherit this CLAUDE.md). `~/src/boxes/test1/` is the primary test box.

**Worktrees** — use `scripts/new-worktree.sh <name>` to set up a parallel worktree. It creates `../callback-mono-<name>` on a new branch, git-clones `~/src/boxes/test1` to `~/src/boxes/test1-<name>` so box mutations stay isolated, and writes a `callback-box/.env` with unique ports (offset by 10 per worktree: main 3210/3211, first worktree 3220/3221, etc.). Tear down with `scripts/remove-worktree.sh <name>`.

**Auto-deploy is `main`-only.** The post-commit hook in `callback-box/.husky/post-commit` only triggers `deploy/deploy.sh` when HEAD is on `main`. Worktrees on other branches commit safely without deploying; ship by merging to `main`.
