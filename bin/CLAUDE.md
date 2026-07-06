# Dev infrastructure: router, worktrees, process lifecycle

Detail for the tooling in this directory (`router.ts`, `worktrees`,
`process-cleanup.ts`, `browse`, `box-entry.ts`, `path-leak-check.ts`). The
always-relevant summary lives in the root CLAUDE.md; this file is the mechanism.

## Home-directory leak guard (`path-leak-check.ts`)

`pnpm path-leak-check` fails if any tracked file contains a real personal home
path (`/Users/<name>/…` or `/home/<name>/…`); the pre-commit hook runs it on
every commit. It's the durable backstop for a source-available repo: audit
reports and docs kept leaking the author's home because agents paste whatever
the ambient environment hands them (Read needs absolute paths; a worktree cwd
is absolute). Fail-closed — `ALLOWED_NAMES` lists the hardcoded deploy service-account homes
(`callback`, `cb-test1`) and placeholders (`me`, `you`, `user`, `x`) that
aren't personal-identity leaks; any other username trips it. Fix a hit with a repo-relative or
`~/…` path, not by widening the allowlist. Background:
`issues/closed/2026-07-05-report-workflows-emit-relative-paths.md`.

## Commit blocklist (`commit-blocklist-check.ts`)

`pnpm commit-blocklist-check` blocks a commit whose staged *additions* contain
any entry from a personal, gitignored `.commit-blocklist` at the repo root; the
pre-commit hook runs it on every commit. Shared mechanism, personal list: the
script is tracked so everyone has the guard, but the strings it blocks live in a
gitignored file so the sensitive values (a purged domain, an IP, personal names)
never enter git. No `.commit-blocklist` → silent no-op (opt-in per person); a
malformed list → fail closed; a *tracked* list → refused. Copy
`.commit-blocklist.example` to start your own.

Rule kinds (one per line, `#` comments and blanks skipped): a bare entry is a
case-insensitive literal **block** substring; `re:` makes it a case-insensitive
regex (`re:\bName\b` word-bounds a short name); `!` is a gitignore-style
**allow** that un-blocks a match whose span sits inside the allow's span (block
`Marlowe`, then `!@marlowe` to permit the public npm scope — a blocked term
elsewhere on the line still fires, so nothing smuggles through); `file:<glob>`
**ignores** a whole file (`*` within a segment, `**` across `/`, a no-slash glob
matches by basename, so `file:package.json` exempts every one — coarse, prefer a
`!` allow for a single token). It scans only staged additions
(`git diff --cached -U0`) — catching re-introduction, not pre-existing content —
and reports `file:line` plus the blocklist entry number, **never the matched
value** (printing it would re-leak exactly what you're purging; look it up with
`sed -n '<N>p' .commit-blocklist`). Bypassable with `--no-verify`, so it's
convenience not enforcement — pair with server-side push protection / a CI scan
for a real gate. Companion to the home-path guard above.

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

PID files at `~/.cache/callback-box/pids/<name>.json` (single-slot —
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
