# Dev infrastructure: router, workstreams, process lifecycle

Detail for the tooling in this directory (`router.ts`, `workstreams`,
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

## Landing a worktree branch (`land`)

`bin/land [branch]` fast-forwards a finished worktree branch onto `main` — what
`/finish` step 8 calls, and what you run by hand to land a branch a finish left
merge-ready. It resolves the main checkout from `--git-common-dir` and targets
it explicitly, so it works from the main checkout or from inside a worktree
(where a plain `git -C ~/src/callback-box merge` is blocked by Claude Code's
worktree isolation).

With no argument: from a worktree it lands that worktree's own branch; from the
main checkout it auto-detects the single merge-ready branch and refuses if
several qualify. `--list` shows candidates, `--dry-run` previews.

It enforces the preflight — main checkout clean, on `main`, `--ff-only` — and
nothing more. Landing is a fast-forward by construction, since `/finish` merges
main INTO the worktree and verifies there; a not-a-fast-forward refusal means
main moved, and the fix belongs back in the worktree.

## Router architecture

One router (`router.ts`, port 3210) serves the main checkout and every
worktree, routing by URL path prefix (`/main/...`, `/<worktree>/...`).
Each worktree gets its own Vite + `cb hub` pair, spawned as direct
children of the router (no Overmind, no tmux — flat process tree). The
hub then lazily spawns/idle-collects a `cb serve` child per box within
that worktree, so boxes cold-start and idle-stop independently of the
worktree they live in. `CB_DEV_NO_HUB=1` reverts to the router spawning
a single legacy `server-main.ts` Fastify process per worktree instead.

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
  browser dev now requires logging in once**, same as a deployed box.
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

## Lifecycle commands

- `bin/workstreams list [--json]` — every worktree joined across all three
  signals: git (ahead/dirty/merged), router runtime (cold/ready/ports), agent
  liveness (none/live/unknown). Works with no router running — `runtime.state`
  then reports `unknown`, which is distinct from a worktree the router knows to
  be `cold`. Counts are `null`, never `0`, when git couldn't answer. It is
  stateless: everything is derived per call, so it cannot drift. Implemented in
  bash rather than TypeScript specifically so the liveness answer comes from
  `wt_other_agent_live` and not a second copy of it.
- `bin/workstreams create <name> [--base-ref <ref>] [--box-ref <ref>]` — create
  or re-attach (idempotent); prints the path on stdout, logs on stderr. A
  recorded `keep/*` box ref restores the isolated test1 clone during a culled
  workstream's recreation.
- `bin/workstreams remove <name> [--force] [--keep-branch] [--dry-run]`
- `bin/workstreams focus <name>` — focus the recorded live Terminal tab
- `bin/workstreams close <name> [--force]` — close a merged, clean live tab;
  force does not override liveness/TTY verification
- `bin/workstreams resume <name> [--agent claude|codex] [--fresh]
[--at-final-sha]` — focus, reopen, or recreate according to registry and git
  state; unknown and unattached names are deliberately refused
- `bin/workstreams reset-test <name>` — hard-reset the isolated test1 clone to
  its `test-setup` branch
- `bin/workstreams confirm-tested <issue-basename>` — clear a landed issue's
  `manual-testing` need on main, delete its `test-setup` branch, and commit the
  issue transition
- `bin/workstreams release <name>` — clear a manual-testing cull pin after the
  code is merged, clean, and no agent is live
- `bin/workstreams status` — raw router status JSON (PIDs, ports, idle ms)
- `bin/workstreams down <name>` — stop one worktree's processes now
- `bin/workstreams panic` — kill router + all known children + wipe state,
  then reclaim project-scoped agent-browsers and any stray vite/fastify
  the pidfiles never tracked (use if you suspect orphans). Spares
  processes owned by an active sibling `claude` session.

Sweep treats an open issue whose `workstream:` matches and whose `needs:` still
contains `manual-testing` as a cull pin. Once released or confirmed, an
unmerged `keep` branch in the workstream's test1 clone is pushed into the source
test1 repository as `keep/<workstream>-<date>` before deletion; a failed push
refuses the cull. The `test-setup` branch is the repeatable reset baseline.

The authenticated top-level `/workstreams/` app exposes the joined status and
safe POST actions, with `/workstreams/issues/`, `/workstreams/plans/`, and
`/workstreams/testing/` beneath it. Router code ships dark from a worktree: the
shared router sees these routes only after merge and a boxholder-run `pnpm dev`
restart. Never restart that shared router from a worktree session.

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
On session exit with no changes the worktree is auto-removed and the
`WorktreeRemove` hook deletes the cloned box and tells the router to stop
the worktree's dev server. With uncommitted changes, Claude Code prompts
to keep or remove.

## Codex worktree sessions

`bin/launch-worktree-session --agent codex` spins up an OpenAI Codex CLI
session in a fresh worktree the same way the default claude path does. Codex
has no `--worktree`, so the launcher's generated launch script calls
`bin/workstreams create <name>` directly (worktree path on stdout; idempotent — a
relaunch re-attaches) — the same command Claude Code reaches through its hook
adapter, so both agents get identical setup — then execs `codex` in
the worktree with full access (`-s danger-full-access -a never`) — parity with
claude workers, which run unsandboxed via `--dangerously-skip-permissions` (a
`workspace-write` sandbox can't commit/`/finish` in a linked worktree, since codex
force-mounts `.git` read-only). Launch-scoped `-c` overrides pre-trust the worktree
and raise `project_doc_max_bytes`; nothing is persisted to `~/.codex/config.toml`.
`--model` maps to `codex -m` (OpenAI model names). Remote Control is claude-only
and ignored for codex.

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
It checks the same two signals sweep
does — `claude --worktree <name>` in argv, and process cwd inside the worktree —
because a session launched by `bin/launch-worktree-session` runs claude from the
main checkout, so cwd alone misses it. It **fails closed**: if `ps` or `lsof`
can't answer, it skips the cleanup, since a lingering worktree is collected by
the next sweep and a deleted one is gone. Without this, a nested headless
`claude -p` — what the `cross-model` skill runs for its Codex→Claude review —
ends its own session, fires the hook, and deletes the worktree out from under
the session that spawned it (this happened on 2026-08-04). Callers should
_also_ pass `--setting-sources user` so the project's hooks never load at all;
the skill documents that as load-bearing. Two independent guards because the
failure destroys work.

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
