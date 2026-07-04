# Dev infrastructure: router, worktrees, process lifecycle

Detail for the tooling in this directory (`router.ts`, `worktrees`,
`process-cleanup.ts`, `browse`, `box-entry.ts`). The always-relevant
summary lives in the root CLAUDE.md; this file is the mechanism.

## Router architecture

One router (`router.ts`, port 3210) serves the main checkout and every
worktree, routing by URL path prefix (`/main/...`, `/<worktree>/...`).
Each worktree gets its own Vite + `cb hub` pair, spawned as direct
children of the router (no Overmind, no tmux — flat process tree). The
hub then lazily spawns/idle-collects a `cb serve` child per box within
that worktree, so boxes cold-start and idle-stop independently of the
worktree they live in. `CB_DEV_NO_HUB=1` reverts to the router spawning
a single legacy `server-main.ts` Fastify process per worktree instead.
URL-prefixed serving uses Vite's `base` option; HMR, API calls, and the
tRPC WebSocket all flow through the router.

## Idle shutdown + self-healing tabs

Only HTTP requests count as worktree activity. WebSocket upgrades never
cold-start a worktree (clients auto-reconnect on timers; honoring them
would let abandoned background tabs resurrect worktrees forever) — the
router refuses upgrades for non-running worktrees with a 503 and the
client retries later. HMR rides the page origin (no `hmr.clientPort` in
vite.config — the browser never learns Vite's internal port), so a stale
tab heals itself: Vite's client pings the router while the tab is
visible, the ping restarts the worktree, and the tab reloads. The
frontend also sends a once-a-minute HEAD heartbeat while visible
(`useDevWorktreeKeepalive`) so a tab you're looking at doesn't idle out
under you; hidden tabs go quiet and their worktree stops after 5 min —
including any in-flight chat turn, which the tab catches up on (via
reload + history) when refocused.

## Orphan resistance

PID files at `~/.cache/callback-mono/pids/<name>.json` (single-slot —
current generation only); router sweeps and kills survivors on startup;
clean SIGTERM/SIGINT kills children with SIGKILL fallback after 2
seconds. Because pidfiles can't see leaked older generations or
agent-browser daemons, the startup sweep also pattern-matches
project-scoped orphans (`process-cleanup.ts`, shared with `panic`):
vite/fastify orphaned to PID 1 (a live router — incl. an isolated test
one — keeps its children, so they're spared) and agent-browsers whose
worktree has no active `claude` session. The generation leak that made
this necessary (concurrent cold requests racing to spawn duplicate
vite+fastify pairs) is fixed at the source in `ensureRunning`.

## Lifecycle commands

- `bin/worktrees status` — JSON of running worktrees, PIDs, ports, idle ms
- `bin/worktrees down <name>` — stop one worktree's processes now
- `bin/worktrees panic` — kill router + all known children + wipe state,
  then reclaim project-scoped agent-browsers and any stray vite/fastify
  the pidfiles never tracked (use if you suspect orphans). Spares
  processes owned by an active sibling `claude` session.

Isolated router testing: `CALLBACK_STATE_DIR` + `ROUTER_PORT` run a
second router without touching the live one (which only picks up
`router.ts` changes after a main-merge + `pnpm dev` restart).

## Worktree lifecycle hooks

`claude --worktree <name>` triggers the `WorktreeCreate` hook: git-clones
`~/src/boxes/test1` to `~/src/box-worktrees/<name>/test1/` (kept outside
the monorepo so the box doesn't inherit monorepo CLAUDE.md; basename
stays `test1` so URL slugs match across worktrees and links like
`/<wt>/test1/...` swap cleanly) and runs `pnpm install` at every level.
On session exit with no changes the worktree is auto-removed and the
`WorktreeRemove` hook deletes the cloned box and tells the router to stop
the worktree's dev server. With uncommitted changes, Claude Code prompts
to keep or remove.

## `/<worktree>/dev/` serving

`/<name>/dev/` serves that worktree's tracked `dev/` directory straight
from disk (never cold-starts the worktree): `.html` as-is, `.md` rendered
via Markdoc. The landing page is a manifest of available views; a
built-in markdown doc browser at `/<name>/dev/docs/` reads every tracked
`.md` in that worktree, grouped by area. Bare `/dev/` redirects to
`/main/dev/`. See `dev/README.md`.
