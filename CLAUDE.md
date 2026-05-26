## Monorepo Layout

Four projects live in one git repository (previously three independent repos, merged 2026-05):

- **callback-box/** — Main system. See its CLAUDE.md for details.
- **callback-clerk/** — Chrome extension that talks to a hosted callback-box instance.
- **cardworks/** — XML card library (parsing, validation, JSX). Used by callback-box (consumed via `file:../cardworks` symlink in `callback-box/node_modules/`).
- **agent-doctest/** — Doctest framework extracted from callback-box.

**Boxes** live at `~/src/boxes/` (outside this repo so agents don't inherit this CLAUDE.md). `~/src/boxes/test1/` is the primary test box.

**Worktrees** — `claude --worktree <name>` (or `-w`) creates a Claude Code worktree at `.claude/worktrees/<name>/` on branch `worktree-<name>` and starts a session in it. The `WorktreeCreate` hook in `.claude/hooks/worktree-create.sh` handles the setup: git-clones `~/src/boxes/test1` to `~/src/box-worktrees/test1-<name>/` (kept outside the monorepo so the box doesn't inherit monorepo CLAUDE.md), writes a `callback-box/.env` with hash-derived unique ports (deterministic per name; main holds 3210/3211, worktrees use 3220+10*hash%100), and runs `pnpm install`. On session exit with no changes the worktree is auto-removed; the `WorktreeRemove` hook then deletes the cloned box. With uncommitted changes, Claude Code prompts you to keep or remove.

**Auto-deploy is `main`-only.** The root husky `post-commit` hook triggers `callback-box/deploy/deploy.sh` only when HEAD is on `main`. Worktrees on other branches commit safely without deploying; ship by merging to `main`.

**Husky lives at the monorepo root.** A single `.husky/` directory at the monorepo top level holds all git hooks (pre-commit dispatches per-subproject; post-commit handles deploy + image-backup cleanup; post-checkout/post-merge/pre-push wrap git-lfs). Subprojects no longer have their own husky setup — they each `prepare: ":"` to opt out. Running `pnpm install` at the monorepo root is what wires up `core.hooksPath`.

**Treat noisy command output as a bug.** Warnings, deprecation notices, "ignored build scripts" lists, peer-dep mismatches, and any other unsolicited output during `pnpm install`, `pnpm test`, builds, etc. cost real agent context every time they appear. Fix the underlying cause (update the dep, add an allowlist entry, silence with a targeted config option, or remove the offending package). Don't ignore a warning that isn't actionable — find a way to stop emitting it. The same goes for output from any tool the agent invokes regularly.
