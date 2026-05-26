## Monorepo Layout

Four projects live in one git repository (previously three independent repos, merged 2026-05):

- **callback-box/** — Main system. See its CLAUDE.md for details.
- **callback-clerk/** — Chrome extension that talks to a hosted callback-box instance.
- **cardworks/** — XML card library (parsing, validation, JSX). Used by callback-box (consumed via `file:../cardworks` symlink in `callback-box/node_modules/`).
- **agent-doctest/** — Doctest framework extracted from callback-box.

**Boxes** live at `~/src/boxes/` (outside this repo so agents don't inherit this CLAUDE.md). `~/src/boxes/test1/` is the primary test box.

**Worktrees** — `claude --worktree <name>` creates a Claude Code worktree at `~/src/callback-worktrees/<name>/` on branch `worktree-<name>` and starts a session in it. The `WorktreeCreate` hook handles setup: git-clones `~/src/boxes/test1` to `~/src/box-worktrees/test1-<name>/` (kept outside the monorepo so the box doesn't inherit monorepo CLAUDE.md), runs `pnpm install` at every level, builds cardworks. On session exit with no changes the worktree is auto-removed and the `WorktreeRemove` hook deletes the cloned box + tells the router to stop the worktree's dev server. With uncommitted changes, Claude Code prompts you to keep or remove.

**Dev server — single router, lazy per-worktree.** Run `pnpm dev` at the monorepo root (or `bin/worktrees serve`). The router listens on port 3210 and routes by URL path prefix:

- `http://localhost:3210/main/<box>/...` — the main checkout
- `http://localhost:3210/<name>/<box>/...` — any worktree (lazy-started on first request, idle-shutdown after 5 min)

Each worktree gets its own Vite + Fastify pair, spawned as direct children of the router (no Overmind, no tmux — flat process tree). The router source is `bin/router.mjs`. URL-prefixed serving uses Vite's `base` option; HMR connects directly to Vite's internal port (bypasses the router). Lifecycle commands:

- `bin/worktrees status` — JSON of running worktrees, PIDs, ports, idle ms
- `bin/worktrees down <name>` — stop one worktree's processes now
- `bin/worktrees panic` — kill router + all known children + wipe state (use if you suspect orphans)

Orphan resistance: PID files at `~/.cache/callback-mono/pids/<name>.json`; router sweeps and kills survivors on startup; clean SIGTERM/SIGINT kills children with SIGKILL fallback after 2 seconds.

**Agents reporting URLs:** when an agent in a worktree wants to show you (or itself) a working URL, it's `http://localhost:3210/<its-worktree-name>/<box>/<path>`. First hit takes ~4s (cold start); subsequent are ~10ms.

**Auto-deploy is `main`-only.** The root husky `post-commit` hook triggers `callback-box/deploy/deploy.sh` only when HEAD is on `main`. Worktrees on other branches commit safely without deploying; ship by merging to `main`.

**Husky lives at the monorepo root.** A single `.husky/` directory at the monorepo top level holds all git hooks (pre-commit dispatches per-subproject; post-commit handles deploy + image-backup cleanup; post-checkout/post-merge/pre-push wrap git-lfs). Subprojects no longer have their own husky setup — they each `prepare: ":"` to opt out. Running `pnpm install` at the monorepo root is what wires up `core.hooksPath`.

**Treat noisy command output as a bug.** Warnings, deprecation notices, "ignored build scripts" lists, peer-dep mismatches, and any other unsolicited output during `pnpm install`, `pnpm test`, builds, etc. cost real agent context every time they appear. Fix the underlying cause (update the dep, add an allowlist entry, silence with a targeted config option, or remove the offending package). Don't ignore a warning that isn't actionable — find a way to stop emitting it. The same goes for output from any tool the agent invokes regularly.
