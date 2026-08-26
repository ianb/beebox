# Dev infrastructure: router, workstreams, process lifecycle

Detail for the tooling in this directory (`router.ts`, `workstreams`,
`process-cleanup.ts`, `browse`, `box-entry.ts`, `path-leak-check.ts`). The
always-relevant summary lives in the root CLAUDE.md; this file is the mechanism.

## Tests for `bin/` tooling

New tests for root dev infrastructure use the repository's primary doctest
format. Put them in `callback-box/test/dev/*.doctest.md`, importing the `bin/`
module or invoking the CLI from there. Pure logic, temporary-filesystem tests,
shell-script fixtures, and CLI behavior all fit doctests; `.test.ts` is not a
separate integration tier. Existing `bin/*.test.ts` files predate this rule and
are not precedent. Add a traditional test only when using a doctest would be
circular (for example, testing the doctest harness itself), and document that
exception in the file.

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
`issues/closed/bugs/2026-07-05-report-workflows-emit-relative-paths.md`.

## Commit blocklist (`commit-blocklist-check.ts`)

`pnpm commit-blocklist-check` blocks a commit whose staged _additions_ contain
any entry from a personal, gitignored `.commit-blocklist` at the repo root; the
pre-commit hook runs it on every commit. Shared mechanism, personal list: the
script is tracked so everyone has the guard, but the strings it blocks live in a
gitignored file so the sensitive values (a purged domain, an IP, personal names)
never enter git. No `.commit-blocklist` → silent no-op (opt-in per person); a
malformed list → fail closed; a _tracked_ list → refused. Copy
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

## Commit provenance trailers (`commit-provenance.ts`)

Two hooks and one script give every commit a queryable link to its
workstream, plan, and (optionally) issue. Convention for agents: root
`CLAUDE.md`. Design: `callback-box/docs/plans/commit-provenance-trailers.md`.

- **`.husky/prepare-commit-msg`** → `commit-provenance --prepare <msgfile>
  <source>`: on a `worktree-<name>` branch, `git interpret-trailers --in-place
  --if-exists replace` stamps `Workstream: <name>` and, when exactly one
  `callback-box/docs/plans/*.md` carries `workstream: <name>`, `Plan:
  <basename>`. Skips `squash` sources, detached HEAD, and `main`. Any error
  prints one stderr line and exits 0 — provenance never blocks a commit.
- **`.husky/commit-msg`** → `commit-provenance --check <msgfile>`: reads the
  trailer block with `git interpret-trailers --parse` (body prose that
  happens to start with `Issue:` is not a trailer) and requires each `Issue:`
  value to match `issues/**/<value>.md`, `closed/` included. A miss blocks
  with the bare-name form and nearest basenames. `private-issues/` is never
  searched — a private slug in public history is a leak.
- **Queries**: `pnpm commit-provenance --workstream|--plan|--issue <name>
  [--main]` — `git log --oneline --grep='^Key: value$'` over `--all` (or
  `main`). Empty result prints nothing.
- `land` merges `--no-ff`, so `git log --first-parent main` lists landings
  and `<merge>^1..<merge>^2` lists what each brought.

Hooks activate on checkout: `core.hooksPath` is the relative `.husky/_`, whose
shim runs `.husky/<hook>` when the file exists — no install step.
Tests: `bin/commit-provenance.test.ts` (a `.test.ts`, not a doctest, because
each case forks a throwaway git repo with its own `core.hooksPath`).

## Landing a worktree branch (`land`)

`bin/land [branch]` merges a finished worktree branch onto `main` with
`--no-ff --no-edit` — what `/finish` step 8 calls, and what you run by hand to
land a branch a finish left merge-ready. It resolves the main checkout from
`--git-common-dir` and targets it explicitly, so it works from the main
checkout, from inside a worktree, or from a Codex session (whose sandbox can't
git the main checkout). Managed Claude worktree sessions are not isolated from
the main checkout — that isolation belongs to native `claude --worktree`, which
they don't use — so `git -C ~/src/callback-box` works there; `bin/land` is
preferred for its checks, not because git is blocked.

With no argument: from a worktree it lands that worktree's own branch; from the
main checkout it auto-detects the single merge-ready branch and refuses if
several qualify. `--list` shows candidates, `--dry-run` previews.

It enforces the preflight — main checkout clean, on `main`, branch already
contains main — and nothing more. That precondition guarantees the `--no-ff`
merge is conflict-free by construction, since `/finish` merges main INTO the
worktree and verifies there; a refusal means main moved since, and the fix
belongs back in the worktree. `--no-ff` always creates a merge commit (`Merge
branch 'worktree-<name>'`) instead of moving main's pointer, so `git log
--first-parent main` lists one entry per landing and `<merge>^1..<merge>^2`
shows what it brought — commit provenance. `.husky/post-merge` deploys on any
merge that updates main (fast-forward or not), so deploy is unaffected; see
`.husky/post-commit`'s merge-commit skip and `.husky/post-merge`'s
`ORIG_HEAD..HEAD` diff for why.

## Router architecture

One router (`router.ts`, port 3210) serves the main checkout and every
worktree, routing by URL path prefix (`/main/...`, `/<worktree>/...`).
Each worktree gets its own Vite + `cb hub` pair, spawned as direct
children of the router (no Overmind, no tmux — flat process tree). The
hub then lazily spawns/idle-collects a `cb serve` child per box within
that worktree, so boxes cold-start and idle-stop independently of the
worktree they live in. `CB_DEV_NO_HUB=1` reverts to the router spawning
a single legacy `server-main.ts` Fastify process per worktree instead.

In a development checkout, `callback-box/bin/cb` stamps the exact CLI bundle
artifact it execs. A hub-spawned `cb serve` child watches that identity; when a
later build replaces it, the child stops admitting mutations, finishes active
requests, chat turns, and scheduled-chat deliveries, then exits with the
expected reload code. The hub supervisor respawns it without consuming the
crash-loop budget. Schedule timers pause during the drain and re-arm from their
persisted entries after replacement. A drain that cannot reach a safe boundary
within ten minutes reopens mutations and keeps the loaded code, with a warning,
rather than wedging the box read-only. The global scheduler uses the same
identity but checks only
between complete all-box passes; its launchd `KeepAlive` service performs the
replacement. Packed installs and `CB_CLI_PREBUILT` production checkouts never
opt into this dev behavior. A standalone foreground `cb serve`/scheduler has no
safe owner to replace it and exits or remains visible rather than self-spawning
an overlapping successor.

`router.ts` holds the process-supervision/proxying machinery only; the
`/<worktree>/dev/` HTML rendering (manifest, markdown doc browser, static
artifact serving) lives in the sibling `router-docs.ts`, imported one-way
(`router.ts` → `router-docs.ts`, never back) to avoid a value-import cycle.

**Before changing worktree lifecycle code** (`ensureRunning`, `startWorktree`,
`stopWorktree`, `onChildExit`, `removePidFile`, the PID-file or `worktrees`-map
shapes), read `bin/docs/router-protocol.md` — it promotes four incident-derived
concurrency invariants (each has a pointing comment at its code site in
`router.ts`) out of inline comments into one durable place, so they survive
future edits instead of being easy to read past or accidentally undo.
URL-prefixed serving uses Vite's `base` option; HMR, API calls, and the
tRPC WebSocket all flow through the router.

## The router is a fail-closed authenticating proxy

Authentication is structurally always-on (open-mode was removed — there is no
`CB_ALLOW_UNAUTHENTICATED` env path anymore), and the router itself now
authenticates every TCP request before it proxies, serves `/<worktree>/dev/`
infra, or cold-starts a worktree — the same front-door model `cb hub` already
runs in prod. Full design and rationale:
`callback-box/docs/implemented-plans/expose-dev-router.md`.

- **Login behind the router prefix works.** The login/setup pages are
  self-contained, server-rendered HTML (a plain `<form>` + inline `<style>`, no
  script/asset references — `callback-box/src/webapp/login-page.ts`), so a
  logged-out browser gets a working login page with zero gated resources — the
  gate never 401s a bundle that never loads. Form action, OAuth link, and every
  server redirect carry the `/<worktree>/` prefix (from `x-cb-base-prefix`). This
  replaced the old React-SPA login page, whose Vite dev modules (`/src/…`,
  `/@vite/…`) the gate 401'd behind the prefix, dead-ending login. No standalone
  `cb serve` workaround needed to test login/OAuth.
- **Two listeners, one gate.** The router listens on both a TCP loopback
  socket (browsers, Tailscale) and a Unix-domain socket at
  `~/.cache/callback-box/router.sock` (or `$CALLBACK_STATE_DIR/router.sock` for
  an isolated test router). The UDS is the trusted-local, **unauthenticated**
  channel — a browser can't originate a UDS connection, so it's a real
  capability boundary, not a spoofable header. `bin/workstreams` and other local
  CLI tools talk to the router over the UDS. **Every TCP request must
  authenticate** — owner session for `/__router/*` control routes plus the `/`
  worktree list and `/<w>/dev/` infra, per-box mobile/session auth for box
  routes — regardless of any Tailscale identity header (those are absent for
  tagged devices/Funnel and are never trusted). The practical upshot: **local
  browser dev normally requires logging in once**, same as a deployed box. The
  agent-authored, read-only `/<w>/dev/` browser also accepts the opt-in
  machine-wide browse key used by `bin/browse`; the worktree index,
  `/workstreams/`, and `/__router/*` remain owner-session surfaces.
- **`cb tailscale setup --target <routerPort>`** (e.g. `--target 3210`) exposes
  the _whole_ router — every worktree and box — over the tailnet through this
  one authenticated front door. Before recording the exposure, setup verifies
  the gate is actually live: it hits the served `/__router/status` over Serve
  with no credentials and requires a `401` (a `200` means an ungated router or
  a Serve misconfiguration, and setup refuses + tears down rather than exposing
  it). `cb tailscale status` reports whether an exposed router is guarded.

## `callback-box/.env` is loaded into every dev process

Each checkout's `callback-box/.env` (gitignored) is parsed with Node's own
`util.parseEnv` and merged into the environment of the children the router
spawns for that worktree — Vite, `cb hub`, and every `cb serve` below it
(`bin/router-core.ts` `readEnvFile`). A real exported variable wins over the
file, so `FOO=x pnpm dev` still overrides. **It is a real env file now, not just
the `BOXES=` line the router greps out of it** — a stray `PATH=` or
`NODE_OPTIONS=` in there reaches every dev process.

The router ALSO loads the main checkout's copy into its own process env at
startup, because the router's own auth gate reads `CB_BROWSE_API_KEY`. One
router fronts every worktree, so that key is effectively machine-level: a
worktree that sets a different one passes its own children and is refused at
the router. One key everywhere is the supported shape.

The WorktreeCreate hook copies the main checkout's `.env` into each new
worktree **minus its `BOXES=` line** — that line points at `~/src/boxes/*`, the
real boxes, and a worktree that inherited it would serve those instead of its
own isolated clone. Existing worktrees predate the copy; do it by hand
(`grep -v '^BOXES=' ../../callback-box/callback-box/.env > callback-box/.env`).

`CB_BROWSE_API_KEY` itself is the local-dev browser credential — see
`callback-box/src/core/browse-key.ts` for what it grants and why it is opt-in.

## Idle shutdown + self-healing tabs

Only HTTP requests count as worktree activity. WebSocket upgrades never
cold-start a worktree (clients auto-reconnect on timers; honoring them
would let abandoned background tabs resurrect worktrees forever) — the
router refuses upgrades for non-running worktrees with a 503 and the
client retries later (silent by default; `CB_ROUTER_DEBUG=1` logs these
refusals). HMR rides the page origin (no `hmr.clientPort` in
vite.config — the browser never learns Vite's internal port), so a stale
tab heals itself: Vite's client pings the router while the tab is
visible, the ping restarts the worktree, and the tab reloads. HMR and the
tRPC WebSocket are TCP traffic like any other request, so they authenticate
through the same gate (a logged-in browser session) — see the router-auth
section above. The
frontend also sends a once-a-minute HEAD heartbeat while visible
(`useDevWorktreeKeepalive`) so a tab you're looking at doesn't idle out
under you; hidden tabs go quiet and their worktree stops after 5 min —
including any in-flight chat turn, which the tab catches up on (via
reload + history) when refocused.

## Backend staleness

The hub runs TypeScript from the checkout through tsx, and nothing reloads it,
so a merge landing under a running generation leaves it executing the old code
while the router still calls it ready. The router now records a token for
`callback-box/src` (excluding `src/frontend`, which Vite hot-reloads) at spawn
and rechecks it at most every 5s on the request path; a mismatch is reported as
`staleSince` in `/__router/status` and as `ready (stale)` in
`bin/workstreams list`. Nothing restarts automatically: the router's only
activity signal is HTTP, so a chat streaming over a WebSocket is
indistinguishable from an idle worktree and there is no moment it can prove is
safe to cut. `bin/workstreams down <name>` is the fix, and it is the human's
call. The box-child half of this is separately solved through
`CB_DEV_BUNDLE_ID`, which drains before re-execing.

## Orphan resistance

PID files at `~/.cache/callback-box/pids/<name>.json` (single-slot —
current generation only); router sweeps and kills survivors on startup;
clean SIGTERM/SIGINT kills children with SIGKILL fallback after 2
seconds. Because pidfiles can't see leaked older generations or
agent-browser daemons, the startup sweep also pattern-matches
project-scoped orphans (`process-cleanup.ts`, shared with `panic`):
vite/fastify orphaned to PID 1 (a live router — incl. an isolated test
one — keeps its children, so they're spared) and agent-browsers whose
worktree has no live agent session. A daemon is never judged on its
pidfile alone until it is old enough to have written one: upstream
writes `<session>.pid` a couple of seconds after the process appears, so
`classifyAgentBrowser` spares any unvouched agent-browser younger than
60s. `bin/browse` calls the same guard (`reclaimWorktreeBrowsers`)
before every command instead of the bash reaper it used to carry, which
knew only about pidfiles and so killed the still-starting daemon of
whichever agent in the worktree had run first. The generation leak that made
this necessary (concurrent cold requests racing to spawn duplicate
vite+fastify pairs) is fixed at the source in `ensureRunning`.

That liveness answer comes from `bin/workstreams agent-liveness`, i.e. from
`wt_other_agent_live` — the same tri-state guard everything else uses, so
`unknown` spares the daemon and a codex session counts exactly as a claude one.
`process-cleanup.ts` carried its own two-state copy until 2026-08-18; it knew
only `claude --worktree <name>` argv plus `pgrep -x claude`, which meant it was
blind to codex (now the default worker agent) and — per the pgrep note below —
to most claude sessions too, and it reclaimed a live Codex worktree's browser
mid-session.

## `bin/workstreams` is the agent-neutral control surface

Worktree creation and removal are CLI subcommands, and every agent frontend is a
thin client of them. `.claude/hooks/worktree-create.sh` and
`.claude/hooks/worktree-remove.sh` are ~15-line adapters that translate Claude
Code's hook JSON into CLI arguments; `bin/launch-worktree-session --agent codex`
calls the CLI directly. The logic lives in `bin/lib/worktree-create.sh` and
`bin/lib/worktree-teardown.sh`. It used to live in the hooks, which meant Codex
had to synthesize hook JSON and pipe it into a file under `.claude/` to reach the
repo's own worktree logic — and any third frontend would have had to as well.
Design and rationale: `callback-box/docs/plans/worktree-control-surface.md`.

**Add worktree behavior to the lib, never to a hook.** A hook that grows its own
logic is invisible to every other frontend, which is how the coupling came back.

**Locations are derived, never hardcoded** (`bin/lib/worktree-paths.sh`):
`wt_paths_init` resolves `WT_MONO` through `git rev-parse --git-common-dir` and
names `WT_ROOT` / `WT_BOX_ROOT` / `WT_BOX_SRC` under its parent. It **fails
closed** rather than falling back to `$HOME/src/callback-box` — a plausible but
wrong root means lifecycle operations on a checkout that isn't the one in play,
which is silent when it happens. Override the basenames with
`CALLBACK_WORKTREE_ROOT` / `CALLBACK_BOX_ROOT` / `CALLBACK_BOX_SRC`.

**Post-merge dependency sync is checkout-local.** `.husky/post-merge` runs
`bin/post-merge-install.sh` before deploy or extension rebuild work. When the
merge changed `pnpm-lock.yaml`, it runs one root `pnpm install
--frozen-lockfile` in the checkout whose hook fired. This applies to main and
worktrees: either checkout can otherwise rebuild the externalized `cb` CLI
against packages its old `node_modules` does not contain. Install failure does
not suppress an eligible server deploy. The hook warns on stderr with the
manual-install remedy; Git does not propagate a post-merge hook's exit status.

**`bin/workstreams create` owns stdout.** Exactly one line — the worktree path —
because Claude Code's WorktreeCreate contract requires it. This is enforced
structurally (the command stashes real stdout on fd 3 and points fd 1 at stderr),
so a child that prints to stdout can't corrupt it. `generate-agents-md.ts` does
exactly that, and its line landed in the returned path until this was added.

**Agent liveness is tri-state, and `unknown` is not `none`.**
`wt_other_agent_live` answers `none` / `live` / `unknown` in `WT_AGENT_STATE`;
every caller must treat `unknown` as `live`, because it stands in front of an
irreversible delete. `bin/workstreams sweep` kept its own two-state copy until
2026-08 and that was a real fail-open hole (a failed `ps`/`lsof` read as "nothing
running"). Sweep keeps its one-snapshot-across-N-worktrees property through
`wt_agent_snapshot_capture` instead of a private implementation. A snapshot and
`--exclude-self-ancestor` are mutually exclusive and the guard refuses the
combination rather than answering wrongly.

**`--force` never overrides liveness.** `bin/workstreams remove --force` skips the
merged and dirty checks only. Unmerged commits are recoverable from a branch; a
running session's working directory is not.

The same rule reaches beyond worktree removal: `bin/process-cleanup.ts` asks
through `bin/workstreams agent-liveness` and spares an agent-browser on
`unknown`, including when the oracle itself can't be run.

## Lifecycle commands

- `bin/workstreams list [--json]` — every worktree joined across all three
  signals: git (ahead/dirty/merged), router runtime (cold/ready/ports), agent
  liveness (none/live/unknown). Works with no router running — `runtime.state`
  then reports `unknown`, which is distinct from a worktree the router knows to
  be `cold`. Counts are `null`, never `0`, when git couldn't answer. It is
  stateless: everything is derived per call, so it cannot drift. Implemented in
  bash rather than TypeScript specifically so the liveness answer comes from
  `wt_other_agent_live` and not a second copy of it.
- `bin/workstreams quotas --json` — normalized Claude and Codex account quota
  windows for the owner dashboard. Codex is read through its app-server
  protocol. Claude is read through the Agent SDK's experimental structured
  usage control request. Claude results are cached for ten minutes and fetched
  only when the dashboard or CLI requests quotas; this consumes no model turn
  or API quota. Machines that installed the retired status-line collector can
  remove its user setting with `bin/workstreams unset-claude-quota`; the command
  refuses to touch an unrelated status line.
- `bin/workstreams archive <name>` / `unarchive <name>` — set or clear a
  presentation-only registry marker. Archiving does not close a session,
  remove a worktree, change its branch, or affect sweep eligibility; it only
  moves the row into the dashboard's archived section.
- `bin/workstreams create <name> [--base-ref <ref>] [--box-ref <ref>]` — create
  or re-attach (idempotent); prints the path on stdout, logs on stderr. A
  recorded `keep/*` box ref restores the isolated test1 clone during a culled
  workstream's recreation. Concurrent creates are supported: Git attachment
  queues briefly per repository, same-name callers wait for complete setup,
  and different-name installs continue in parallel. This guarantee covers the
  managed lifecycle commands; do not mix a concurrent create with Claude
  Code's native worktree removal, whose Git mutation happens outside repo
  tooling (the WorktreeRemove adapter still protects same-name satellites).
- `bin/workstreams remove <name> [--force] [--keep-branch] [--dry-run]`
- `bin/workstreams focus <name>` — focus the recorded live Terminal tab
- `bin/workstreams close <name> [--force]` — close a merged, clean live tab;
  force does not override liveness/TTY verification
- `bin/workstreams resume <name> [--agent claude|codex] [--fresh]
[--at-final-sha] [--] [<briefing> | - | @file]` — focus, reopen, or recreate
  according to registry and git state; unknown and unattached names are
  deliberately refused. A dormant session launches with the supplied briefing
  (including `codex resume --last`); a live session writes a unique local file,
  focuses its tab when possible, and reports `manual forwarding required`.
  Use `--` before literal briefing text that begins with `-`.
  **Claude continues its prior conversation** when the registry's `sessionId`
  still has a transcript under `~/.claude/projects/*/` — the worktree is
  recreated at the same path, and Claude Code keys transcripts by path, so the
  history outlives a cull. The briefing (or the recreated-worktree note) is the
  continued session's first message. It starts fresh on `--fresh`, with no
  recorded id, or when the transcript is gone, and the launch line says which
  and why. The transcript check happens before the tab opens: `--resume` with a
  pruned id fails inside the tab, where there is no fallback left. Only the
  recorded id is ever used — a project directory routinely holds several
  transcripts, and the newest is not the one that did the work. The id shape
  this decision accepts is the shape `launch_session_build`'s own guard
  demands, because that guard runs after `resume` has committed to continuing:
  a disagreement between them is no session at all, not a fresh one.
- `bin/workstreams reset-test <name>` — hard-reset the isolated test1 clone to
  its `test-setup` branch
- `bin/workstreams confirm-tested <issue-basename>` — clear a landed issue's
  `manual-testing` need on main, delete its `test-setup` branch, and commit the
  issue transition
- `bin/workstreams release <name>` — clear a manual-testing cull pin after the
  code is merged, clean, and no agent is live
- `bin/workstreams status` — raw router status JSON (PIDs, ports, idle ms)
- `bin/workstreams down <name>` — stop one worktree's processes now
- `bin/workstreams agent-liveness <path>...` — tri-state claude/codex liveness
  per absolute path, as JSON, from the one shared guard. Takes paths rather
  than names so a caller with its own notion of where checkouts live needs no
  agreement about roots. For tooling that stands in front of something
  destructive; `process-cleanup.ts` is the caller.
- `bin/workstreams panic` — kill router + all known children + wipe state,
  then reclaim project-scoped agent-browsers and any stray vite/fastify
  the pidfiles never tracked (use if you suspect orphans). Spares
  processes owned by a live sibling `claude` or `codex` session.

Sweep treats an open issue whose `workstream:` matches and whose `needs:` still
contains `manual-testing` as a cull pin. Once released or confirmed, an
unmerged `keep` branch in the workstream's test1 clone is pushed into the source
test1 repository as `keep/<workstream>-<date>` before deletion; a failed push
refuses the cull. The `test-setup` branch is the repeatable reset baseline.

The authenticated top-level `/workstreams/` surface is a resident Fastify +
Vite app in the top-level `workstreams-app/` package. The router authenticates,
supervises, and proxies it; the app invokes the stable `bin/workstreams` CLI
instead of reimplementing lifecycle guards. It exposes joined status and safe
actions, with `/workstreams/issues/`, `/workstreams/plans/`, and
`/workstreams/testing/` beneath it. An open issue ends with a **Related** list —
nearest issues (open and closed) and design docs, the same ranking as
`bin/issues similar --all --docs` (see that section for the shared library and
the key it needs). App source changes landed in main reload the
app child without restarting the router. Router or supervisor changes still
require one boxholder-run `pnpm dev` restart after merge. Never restart the
shared router from a worktree session.

`bin/workstreams list` is also the routing inventory. Its JSON and table carry
an optional one-line session description plus two separate decisions:
`routing.state` (`launching`, `live`, `scheduled`, `dormant`, `stale`,
`removed`, `uncertain`) and
`routing.action` (`manual-forward`, `resume-with-briefing`,
`new-stream-preferred`, `investigate`). `stale` means approximately 14 days
without trustworthy activity and is guidance to start a new stream, not a
resume prohibition. `scheduled` is a `kind: "scheduled"` record resting between
runs: sticky by design, so `remove`, `sweep`, and prune cull its worktree but
never its record, `archive` refuses it (set `enabled: false` in its
`schedule.yaml` instead), and `list` renders it with no worktree at all. A cull
records the tip it happened at under `culled` (never `removed`, which would
hide the row), and `resume` reads that pointer for its "landed since" log the
same way it reads `removed.finalSha`. Every
row also carries a `schedule` field — cadence, last run and outcome, overdue,
open alerts, and the scheduler's own last tick — joined by name from one
`bin/schedules list --json` call per listing, and null for a workstream that is
not a schedule. The liveness input still comes only from
`wt_other_agent_live`; the app consumes this projection and never reimplements
the destructive guard. Non-worktree directories under the managed root are
reported and skipped. The app parses rows independently so one malformed row
produces a visible warning instead of blanking every view.

Isolated router testing: `CALLBACK_STATE_DIR` + `ROUTER_PORT` run a
second router without touching the live one (which only picks up
`router.ts` changes after a main-merge + `pnpm dev` restart).

## Worktree lifecycle hooks

`claude --worktree <name>` triggers the `WorktreeCreate` hook, which calls
`bin/workstreams create` (see the control-surface section above). That: git-clones
`~/src/boxes/test1` to `~/src/box-worktrees/<name>/test1/` (kept outside
the monorepo so the box doesn't inherit monorepo CLAUDE.md; basename
stays `test1` so URL slugs match across worktrees and links like
`/<wt>/test1/...` swap cleanly), runs `pnpm install` at every level, and
generates the gitignored AGENTS.md mirrors (next section).
Direct native sessions retain Claude's own exit behavior. Managed sessions from
`bin/launch-worktree-session` deliberately do not pass `--worktree`: they call
`bin/workstreams create`, change into the resulting checkout, and let the
repository's SessionEnd hook plus later sweeps own cleanup. This avoids asking
the boxholder to keep or remove a worktree when the registry can safely retain
it and cull it later.

## Codex worktree sessions

`bin/launch-worktree-session --agent codex` spins up an OpenAI Codex CLI
session in a fresh worktree the same way the default Claude path does. Both
generated launch scripts call `bin/workstreams create <name>` directly
(worktree path on stdout; idempotent — a relaunch re-attaches), so both agents
get identical setup. The Codex path then execs `codex` in
the worktree with full access (`-s danger-full-access -a never`) — parity with
claude workers, which run unsandboxed via `--dangerously-skip-permissions` (a
`workspace-write` sandbox can't commit/`/finish` in a linked worktree, since codex
force-mounts `.git` read-only). Launch-scoped `-c` overrides pre-trust the worktree
and raise `project_doc_max_bytes`; nothing is persisted to `~/.codex/config.toml`.
`--model` maps to `codex -m` (OpenAI model names). When it is omitted, the
launcher explicitly uses `gpt-5.6-sol` rather than inheriting Codex CLI state;
this keeps a stale or unavailable saved default from breaking the first turn.
An explicit model still wins, including the model recorded for a resumed
workstream. Remote Control is claude-only and ignored for codex.

Codex's `workspace-write` sandbox confines **writes** (workspace + the `--add-dir`
roots) and network, but **reads are global** — verified empirically 2026-08-04: a
codex session reads files in a sibling worktree outside every writable root fine.
So a codex worker can inspect other in-progress worktrees (`git worktree list`,
`git -C <path> status`/`diff main`) with no extra grant; the root preamble tells it
so. Broadening read scope needs nothing; only _writing_ another worktree would.

Codex reads AGENTS.md where Claude reads CLAUDE.md (root→cwd chain injected
at startup; nested files discovered by the model as it works, per its own
system prompt), and scans `.agents/skills/` for repo skills.
`bin/generate-agents-md.ts` writes a gitignored AGENTS.md mirror next to every
tracked CLAUDE.md, embeds tracked `.claude/rules/*.md` at their nearest AGENTS.md
scope, and symlinks every tracked `.claude/skills/<name>/` into
`.agents/skills/<name>` — preserving each skill's scripts, references, and
assets. CLAUDE.md and rule content stays verbatim except for generated framing
and a root-level Codex preamble
(harness-feature mapping, worktree orientation, a `CODEX-AGENTS-LOADED`
sentinel for verifying the docs actually loaded). The one committed
find-replace AGENTS.md rotted and mangled commands (removed in 872450eb), so
mirrors regenerate at every spin-up (both hook paths, fresh AND resume); the
generator refuses to overwrite a tracked AGENTS.md or an existing non-generated
Codex skill. The launcher's codex path fails closed if the root mirror is
missing.

Tracked `.claude/rules/*.md` files are embedded verbatim into the generated
AGENTS.md at their nearest directory scope. Their `paths` frontmatter remains a
conditional applicability instruction; it is not copied into Codex's rules
directory, because Codex command-execution rules have different semantics.

**Teardown is driven by the launcher, not by hooks.** Codex reads none of
`.claude/settings.json`, so no SessionEnd/WorktreeRemove ever fires for it —
until this was fixed, a codex worktree lingered until someone ran
`bin/workstreams sweep` by hand (~10 had piled up by 2026-08-04). So the
launcher **runs codex in the foreground instead of `exec`ing it** (there'd
otherwise be no "after codex exits" moment) and then calls
**`bin/codex-session-end <worktree-path>`**, which gives codex the same
teardown claude gets: auto-remove when the branch is merged into main and the
tree is clean, and an interactive keep/remove prompt at the tty otherwise —
codex's stand-in for Claude Code's own built-in prompt. Choosing _remove_ with
unmerged commits still keeps the **branch** (`--keep-branch`); only the tree,
the box clone, and the router/cache state go. Anything other than an explicit
`r` keeps: no tty, timeout, EOF, empty line. Closing the tab is still
uncovered — SIGHUP kills the launcher before codex returns, the same gap a
claude tab-kill has — and the next sweep collects it.

`bin/launch-worktree-session` wraps the codex call in `trap 'true' INT`: bash
defers a trap until the foreground command returns, so a Ctrl-C reaches codex
(a trap with a body, unlike `''`, is reset to default in the child) without
taking the launcher down before teardown. The teardown invoked is the **main
checkout's** copy, and it `cd`s to main before touching anything — a script
must not run destructive steps from inside the directory it deletes.

**The global sweep is detached, serialized, and fired from an `EXIT` trap.**
`.claude/hooks/auto-sweep.sh` re-invokes itself with `--run` through
`bin/lib/detach.ts` (Node's `detached: true`, i.e. `setsid(2)`) rather than
`& disown`, which leaves the child in the caller's process group and so died
with the very session whose exit triggered it — 15 of 109 SessionEnd sweeps
logged a `START` with nothing after it, against zero of the SessionStart and
codex ones. The `--run` half holds an atomic `mkdir` lock (macOS has no
`flock(1)`) and **skips** rather than queues, reclaiming a lock whose recorded
pid is dead. A caught signal writes `INTERRUPTED`, so a bare `START` now means
SIGKILL specifically. `session-end.sh` triggers it from a `trap … EXIT`: that
is reachable from every one of the hook's early `exit 0`s — the property the
old inline placement was protecting — while still running last, so the cheap
per-worktree teardown no longer overlaps the sweep's git work across every
other tree. The hook also logs `step=` elapsed times for the liveness scan and
the git work, because a cancelled hook used to say only that it died somewhere
between them.

**One implementation of the destructive path: `bin/lib/worktree-teardown.sh`**
(sourced, not executed), shared by `.claude/hooks/session-end.sh`,
`.claude/hooks/worktree-remove.sh`, `bin/codex-session-end`, and
`bin/workstreams` (`list`, `remove`, `sweep`). It owns `wt_other_agent_live` (the
fail-closed tri-state live-agent guard) with `wt_agent_snapshot_capture` for
batched callers, `wt_work_state` (ahead/dirty/blockers), `wt_remove_now` (the
full trash-mv removal), the pieces it is built from —
`wt_remove_private_issues`, `wt_remove_satellites` (box clone + router stop +
cache state, which is all the WorktreeRemove hook wants, since Claude Code
removes the git worktree itself there), `wt_trash_reap` — and `wt_log` (the
shared `worktree-cleanup.log`, labeled per caller). Sweep counts a live `codex`
process whose cwd is in a worktree as an active session, same as claude.

**Auto-sweep is submitted, not merely backgrounded.** SessionStart, SessionEnd,
and codex teardown call `.claude/hooks/auto-sweep.sh`; on macOS its trigger mode
submits a uniquely labeled one-shot launchd worker and returns before sweep. A
request marker plus a whole-sweep kernel lock coalesces overlapping triggers
without dropping the trailing request. Worker logs always pair `SUBMITTED`,
`START`, and `END status=…` when they reach those phases, and its EXIT trap
removes the launchd label so the submitted job cannot respawn as a daemon.

**Detecting a live agent process: use `ps -axo pid=,comm=`, never `pgrep -x
claude`.** pgrep matches the 16-char accounting name (`ps ucomm`), and a
native-installed Claude Code reports that as its _version_ (`2.1.221`), not
`claude` — so `pgrep -x claude` misses live sessions almost entirely (10 of 11
running sessions invisible when measured 2026-08-04). `ps comm` is the
executable path; match on its basename. Both `bin/workstreams sweep` and
`bin/lib/worktree-teardown.sh` do it that way for exactly this reason; a guard
built on pgrep silently protects nothing.

**A nested `claude` run must not clean up the worktree it runs inside.**
`wt_other_agent_live` refuses to clean when another live `claude`/`codex`
process belongs to the worktree. `session-end.sh` passes
`--exclude-self-ancestor`, which excludes the _nearest_ agent ancestor of the
hook (that one is the session that's ending); `bin/codex-session-end` does not,
because codex has already exited by the time it runs — there is no self to
exclude, and not excluding one is the conservative answer for a hand-run.
It checks the same two signals sweep does — `claude --worktree <name>` for
direct native sessions or the managed `claude --name <name>` marker in argv,
plus process cwd inside the worktree for managed Claude and Codex sessions. It
**fails closed**: if `ps` or `lsof`
can't answer, it skips the cleanup, since a lingering worktree is collected by
the next sweep and a deleted one is gone. Without this, a nested headless
`claude -p` — what the `cross-model` skill runs for its Codex→Claude review —
ends its own session, fires the hook, and deletes the worktree out from under
the session that spawned it (this happened on 2026-08-04). Callers should
_also_ pass `--setting-sources user` so the project's hooks never load at all;
the skill documents that as load-bearing. Two independent guards because the
failure destroys work.

## Schedules (`bin/schedules`)

Recurring work: one directory per job under `schedules/`, one launchd tick, one
alert store. The root CLAUDE.md has the contract; the `cb-authoring-schedules`
skill is how to write one. Design:
`callback-box/docs/plans/scheduled-workstreams.md`. Mechanism, in the spirit of
the router protocol above:

- **The store lives beside the main checkout**, never inside it:
  `<parent>/schedule-runs/` (override `CALLBACK_SCHEDULES_ROOT`), the exhibits
  and comments convention, with the same marker-file discipline — a directory
  without `.schedule-runs` in it is refused rather than adopted. One store
  behind every worktree, so a run's history does not evaporate with whichever
  checkout happened to trigger it, and logs stay out of git (the boxholder
  asked for that explicitly). Per schedule:
  `<name>/state.json` (`lastRunAt`, `lastRunId`, `lastExit`, `lastOutcome`, and
  a persistent session's id), `runs/<id>.{log,handoff.json,result.json,exit.json}`,
  `alerts/<id>.json`, and a `lock/` directory (mkdir with the PID inside; a
  dead PID is reclaimed and its unreported run accounted for — as is a lock
  written before the current boot or older than the run could possibly be,
  since PID reuse after a reboot otherwise holds a lock forever). State is
  written read-modify-write under that lock: a run's outcome and the session id
  minted mid-launch both update the same file.
- **The heartbeat is the anti-silence primitive.** Every `tick` stamps the
  store root's `state.json` (`lastTickAt`, `lastTickExit`) as soon as it holds
  the tick lock, before it looks at any schedule. A tick that finds the lock
  held stamps `lastTickSkippedAt`/`lastTickSkippedReason` and leaves
  `lastTickAt` alone — a tick hung inside a child would otherwise keep the
  heartbeat reading "just now" forever while nothing ran; `list` prints the
  skip beside the last real tick. That is what makes "nothing has run for a week"
  visible without any job reporting its own death — `bin/schedules list` prints
  it, every `bin/workstreams list` row carries it, and `bin/doctor.ts` checks
  both it and whether the plist is loaded. `tick` exits non-zero only when it
  cannot write the store; a schedule that failed is already an alert, so the
  launchd log stays meaningful.
- **Due-ness is computed, never delegated to launchd.** One `StartInterval`
  tick every 15 minutes plus a persisted `lastRunAt` — anacron's semantics —
  because `StartCalendarInterval` misses jobs the machine slept through and
  says nothing. Overdue is derived (`now - lastRunAt > cadence + grace`) and
  never stored; a never-run schedule is *due*, not overdue.
- **The alert store is the message channel.** `bin/schedules alert` writes a
  record (workstream, title, message, optional Markdown details, priority
  `important|normal|backlog|fyi`) and then delivers a macOS notification as one
  best-effort delivery of it — the record is the truth, and acknowledged alerts
  fade from the default views after 14 days without being deleted. `done` is
  the "finished, nothing to say" marker: a run with a session and neither
  record is a bailed run and raises an `important` alert of its own.
- **The CLI is the only writer.** The workstreams app shells out to
  `bin/schedules ack` rather than touching the store, the same way it invokes
  `bin/workstreams` for lifecycle instead of reimplementing the guards. A `run`
  script reaches the store only through `handoff`/`alert`/`done` — there is no
  free-form handoff file — and every record is Zod-parsed at the boundary
  (`bin/lib/schedules.ts`) and written atomically (temp name, rename).

## Headless agent sessions (`bin/lib/launch-headless.sh`)

A scheduled run that has work starts its agent through the same lifecycle a
Terminal session uses — `bin/workstreams create`, `wt_other_agent_live`, the
registry's launch lease — but with no tab: `claude -p` / `codex exec` in the
foreground, the briefing on **stdin** (never argv), output appended to the run
log, killed at the schedule's `timeout`. `launch-headless.sh` is the ONE place
those flags are assembled; source it (`launch-session.sh` does) or execute it to
print the argv one element per line. Codex has no equivalent for `tools` /
`allowedTools` / `disallowedTools` / `maxBudgetUsd` / `effort`, so a codex
schedule that declares any of them is refused rather than launched
unconstrained, and its
`prompt.md` leads the briefing instead of riding `--append-system-prompt-file`.
The session reports by writing a record (`bin/schedules alert` or `done`); one
that ends without either is an `important` alert. Design:
`callback-box/docs/plans/scheduled-workstreams.md`, Track B.

## Linting a schedule (`bin/schedules lint`)

`bin/schedules lint [--json]` checks every `schedules/<name>/` without running
it: the `schedule.yaml`/`local.yaml` schema, `run` and `check` executable and
carrying a shebang, `run` honoring `SCHEDULE_DRY_RUN`, `prompt.md` naming
`bin/schedules alert`, shellcheck over the shell scripts (the pinned npm
`shellcheck`, fetched lazily on first use), and eslint over the TypeScript ones.
Silent on success; one `schedules/<name>/<file>: <message>` line per finding
otherwise. Pre-commit runs it whenever anything under `schedules/` is staged,
and a `tick` raises one `important` alert per broken schedule — latched on that
alert staying open, so a schedule left broken is one record rather than one
every fifteen minutes.

`schedules/**/*.ts` is the only root path the root `eslint.config.ts` lints;
`bin/` and `dev/` stay unlinted by decision (the comment in that file says why).

## Document comments (`bin/comments`)

The boxholder's channel for talking to an agent **about a document**: a remark
anchored to a span, written in the browser at `/workstreams/browse`, waiting in
a store until an agent reads it. Design: `callback-box/docs/plans/document-comments.md`.

- **Read them.** `bin/comments show <path>` for one document (any path spelling
  — absolute, repo-relative, cwd-relative); `bin/comments list` for everything
  waiting; **`bin/comments list --workstream <name>` for what is addressed to
  YOUR workstream**, newest first. That last one is the command an agent
  actually wants.
- **Clear them when handled.** `bin/comments clear <path> [--id <id>]`. Nothing
  expires on its own — a comment waits until an agent says it is done with it.
  Folding a remark into the document itself is the usual resolution; quote it
  rather than paraphrasing, since the boxholder's words are what the store kept.
- **`--json` on any command** for a machine reader. `bin/comments add` exists so
  the app can write through one implementation; a human types in the browser.

**Where they live, and why nothing can delete them.** A store beside the main
checkout (`<parent>/dev-comments/`, override `CALLBACK_COMMENTS_ROOT`), mounted
read-only into each checkout as a gitignored `comments` symlink. It is the
exhibits store's third persistence class: survives a worktree cull, never
merges, never reaches git. Two namespaces, because a repository-relative path is
not a unique document — `tracked/<path>` follows a file everywhere, while
`worktree/<name>/<path>` stays put, since two worktrees routinely hold entirely
different `scratch/notes.md`.

**The cost of being cull-proof** is that a culled workstream's comments on
untracked files outlive it, and a recreated workstream of the same name inherits
them. Filed as
`issues/features/2026-08-22-orphaned-comment-namespaces-after-a-cull.md`; the fix
direction is to report orphans, never to delete at cull time.

**The CLI is the only writer.** The workstreams app shells out to it rather than
reaching into the store, the same way it invokes `bin/workstreams` for lifecycle
rather than reimplementing the guards. Two writers to one YAML format sharing
one lock protocol is where duplication stops being controllable.

## Searching the issue queue (`bin/issues`)

A stateless CLI over `issues/` plus `private-issues/` when that mount exists
(rows carry a `visibility`). It reuses `workstreams-app/src/server/issue-domain.ts`
for parsing — the dev issue browser and this command must agree about what an
issue is — and adds two derived fields the frontmatter does not carry: `date`
from the `YYYY-MM-DD-` filename prefix, and `discoveredInWorkstream`, the bare
name inside `discovered-in:`'s `worktree-<name>` token.

**The library lives in the app, not in `bin/`.** `issue-search-model.ts`
(load/derive/filter/group), `issue-index-documents.ts` (what gets indexed and
its two hashes), `issue-index.ts` (the Orama cache + refresh), and
`issue-index-query.ts` (ranking) are all in `workstreams-app/src/server/`,
beside `issue-domain.ts`; `bin/issues.ts` imports them the same way it already
imported the parser. That is because the issue browser's **Related** section
(`issues.related`, `issue-related-service.ts`) is the same ranking as `issues
similar <path> --all --docs` over the same cache — one implementation, two
callers, so a row an agent quotes from the CLI is the row the boxholder sees.
The app is long-lived, so it holds the built index in process and re-reads the
corpus at most every 30s to decide whether anything changed.

- `issues list [filters]` — the filtered queue, newest first.
- `issues groups --by discovered-in|date|labels|area|workstream|category` —
  clusters, largest first, with their members (`--min N`, default 2).
- `issues search <text>` — `--mode text` is BM25 and offline; `hybrid` (the
  default when a key is available) fuses BM25 with vector similarity;
  `semantic` is vector only.
- `issues similar <issue-path> [--docs]` — nearest neighbours of an issue by its
  own stored vector. `--docs` also ranks `callback-box/docs/**/*.md`, so an
  existing plan surfaces as prior art instead of being re-derived.
- `issues show <path>` — frontmatter as JSON plus the top of the body.

Every subcommand takes `--json`, and defaults to open issues (`--closed` for
only closed, `--all` for both). Filters: `--category --area --label --workstream
--discovered-in --needs --priority --next-action --since --research
--visibility`. Repeats are OR within one filter and AND across filters —
except `--label`, where repeats mean AND, since labels are how a cross-cutting
effort is picked out.

**The `.issues-index/<scope>/` cache** at the repo root is gitignored and
disposable: a persisted Orama index, the embedding vectors, and a manifest of
`{ indexHash, embeddedHash }` per file. Every run re-reads every issue (cheap);
the manifest answers only what re-reading cannot. The two hashes are separate on
purpose — `indexHash` covers every indexed field, so a frontmatter-only edit
rebuilds the index (otherwise a `where:` filter would keep matching the old
`workstream`/`needs`/`priority`) while costing nothing in embeddings;
`embeddedHash` records the text the stored vector was actually computed from, so
a run that cannot embed drops the stale vector instead of adopting it under the
new hash. Re-embedding is one batched call. `--rebuild` wipes the cache and pays
for the whole corpus again.

`--mode text` never touches the network, which is what makes the command usable
with no key at all. `--mode hybrid` and `--mode semantic` are assertions that
BM25 will not do, so they **error** when there is no key or the corpus is not
fully embedded; only the unspecified default degrades to text, and it says so on
stderr. The key is read from `CALLBACK_OPENAI_API_KEY`, then
`THINKING_OPENAI_API_KEY`, then `SKE_OPENAI_API_KEY`.

The same order applies to the app's Related section (and to comment
transcription), read from the **app child's** environment: the supervisor
spawns it with the main checkout's `callback-box/.env` underneath
`process.env`, the same precedence worktree children get, so a
`CALLBACK_OPENAI_API_KEY=` line there is enough and an exported variable
still wins. The router does not load that line into itself. With
no key the section says so — "the semantic index needs an OpenAI key" is a
state it renders, not an error page.

**Private issues are indexed too**, which means their text is sent to OpenAI to
be embedded, and their bodies sit in the local cache. Both are consistent with
where private issues already live (a local repo on the developer's machine, read
by agents that call hosted models), but it is a real egress. `--visibility
public` is the control: it selects the separate `public` cache and never reads
the private queue at all, so nothing private is loaded, indexed, or embedded on
that run — the scopes get their own directories precisely so alternating between
them does not look like every entry vanished and re-appeared. `--mode text`
avoids the network entirely.

## Private-issues shadow repo (`private-issues`)

`bin/private-issues` manages the per-developer private issue repo
(`issues/CLAUDE.md` has the what-goes-where rules; the plan is
`callback-box/docs/implemented-plans/private-issues-shadow-repo.md`). Design invariants,
in the spirit of the router protocol above:

- **Symlink topology is the safety property.** Every checkout's
  `private-issues/` is a symlink (main → the private repo's primary tree;
  worktree → a private worktree at `<parent>/private-issues-worktrees/<name>`
  on branch `worktree-<name>`). No public-worktree removal path can touch
  private files — it deletes a symlink. Never "simplify" the mount into a
  real directory inside the worktree.
- **Locations are derived, never hardcoded** — peers of the main checkout,
  found via `git rev-parse --git-common-dir` from an explicit checkout-path
  argument. The private repo must carry the identity marker
  (`.callback-private-issues` + `callback.privateIssues` git config) before
  any command mutates it; a same-named unrelated dir is refused.
- **Remove-if-safe, orphan-if-not.** Cleanup (session-end, worktree-remove,
  sweep) removes a private worktree only when merged into private `main` AND
  strictly clean (no deletion-only exemption — deleting a private issue is
  intentional work). Everything else is preserved as an orphan; nothing ever
  forces, escalates a git refusal, or auto-commits. `bin/workstreams sweep`
  reports orphaned private worktrees/branches unconditionally every run —
  that report, not hook logs, is the durable discovery mechanism.
- **All private-repo mutations serialize through the mkdir lock** in the
  CLI (`pi_lock`), with safety checks re-run after acquiring — session-end
  fires auto-sweep in the background and keeps cleaning, so concurrent
  writers are routine, and concurrent `git worktree prune` corrupts state.
- **`.gitignore` uses `/private-issues` with NO trailing slash** — a
  dir-only (`…/`) pattern does not match a symlink, which would make the
  mount stageable and defeat the leak guard.

## Multiple agents sharing one worktree

A plan can spawn several concurrent task agents committing straight to the
same shared worktree/branch (e.g. the architectural-review round). `git add
<paths>` followed by a bare `git commit` is not atomic across processes: one
agent's already-staged-but-uncommitted changes can be swept into a
concurrently-running `git commit` from another agent, landing under the
wrong commit's attribution. The fix is always **path-scoped commits**:
`git add <paths> && git commit -- <paths>` (or the `stageAndCommitPaths`
helper in `callback-box/src/lib/git.ts`), never a bare `git commit` —
scoping the commit to exactly the paths this agent staged means an
interleaved sweep from another agent can't get co-committed under this
one's message. This is a convention, not a lock: each agent is responsible
for scoping its own commits. (`lint-staged`'s pre-commit run uses
`--no-stash`, so a failing task no longer `git reset --hard`s the whole
worktree on top of this — see
`../issues/closed/bugs/2026-07-10-pathspec-commit-lint-staged-clobber.md`.)

## `/<worktree>/dev/` serving

`/<name>/dev/` serves that worktree's tracked `dev/` directory straight
from disk (never cold-starts the worktree): `.html` as-is, `.md` rendered
via Markdoc. The landing page is a manifest of available views; a
built-in markdown doc browser at `/<name>/dev/docs/` reads every tracked
`.md` in that worktree, grouped by area. Bare `/dev/` redirects to
`/main/dev/`. See `dev/README.md`.
