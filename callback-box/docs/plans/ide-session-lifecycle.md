# The /ide/ app and disposable sessions

**Status:** active — designed 2026-08-09, not yet implemented; written for Codex
implementation.

A new top-level router app at `/ide/` — a development control surface that is
not worktree-bound — plus the session/worktree lifecycle machinery it fronts: a
session registry, terminal focus/resume/close commands, cull records that make
merged worktrees recreatable, and machine-readable plan/issue frontmatter. The
goal: a terminal tab stops being the only record of work in flight, so sessions
become disposable.

**Issues addressed:**

- [worktree/session workflow redesign](../../../issues/features/2026-08-08-worktree-session-workflow-redesign.md)
  — the primary item; this plan is the workflow change its enabling refactor
  ([the worktree control surface](worktree-control-surface.md)) deferred.
- [plans need frontmatter and issue mapping](../../../issues/docs-and-chores/2026-08-08-plan-lifecycle-frontmatter-and-issue-mapping.md)
  — Track E.
- Related, advanced but not closed:
  [manual-testing flag overuse](../../../issues/decisions/2026-07-29-manual-testing-flag-overuse.md)
  stays open; nothing here assumes more `manual-testing` items (see NOT in
  scope). The
  [events.db two-engine bug](../../../issues/bugs/2026-08-08-events-db-truncates-across-engine-checkouts.md)
  and box forking stay in the redesign issue's territory, untouched here.

## Jobs to be done

- When I finish reviewing a worktree's work and it has merged to main, I want
  to close its terminal tab without losing the way back, so my terminal stops
  being a to-do database (~9 tabs accumulate today because closing feels
  lossy).
- When manual testing of a landed change reveals a problem days later, I want
  to pull up that worktree AND the conversation that built it, so the follow-up
  starts with full context instead of a cold agent.
- When I sit down to work, I want one page that shows which worktrees are
  actually in progress (unmerged, dirty, or live), so outstanding work is
  visible without scanning terminal tabs.
- When a merged worktree was culled and I need to revisit it, I want to
  recreate it — from main, with the session told what commits landed since it
  last touched the branch — so the cull cost nothing.
- When I'm looking at the in-progress list, I want buttons that focus the
  existing terminal tab or launch a new one, so "switching" means naming the
  worktree, not hunting the tab bar. (Launching *new* work stays
  session-driven — `launch-worktree-session` from a conversation remains the
  primary creation path; /ide/ is for seeing and returning, not for starting.)

## Stated preferences this plan trades against

- `docs/engineering-principles.md` §4 (resilient AND never silent — the
  tri-state liveness discipline in front of every destructive action), §7
  (hierarchy is a discoverability contract — /ide/ is where non-worktree-bound
  dev tooling *says* it lives), §8 (one way to do each thing — resume must not
  fork a second launch path), §11/§12 (enforcement beats convention; the
  maintainer is usually an agent — frontmatter over prose conventions).
- `bin/CLAUDE.md` — router invariants, the fail-closed authenticating proxy
  model, the `ps -axo pid=,comm=` rule, "read `bin/docs/router-protocol.md`
  before touching lifecycle code".
- [worktree-control-surface.md](worktree-control-surface.md) — the Track C
  `list --json` contract (this plan extends it additively), the Track D
  `resume` design (this plan builds it, revised), and the hard constraint it
  carries: **Codex is a first-class frontend; nothing may be Claude-Code-only.**
- Boxholder constraints from the redesign issue: web for seeing, terminal for
  doing; no tty multiplexers; Terminal.app stays (open to another terminal
  later — the terminal-specific code is isolated to one adapter, see Track B).
- Memory/feedback: plan more, not less; consolidate over blast-radius fear;
  stop over-engineering rare failures (bounds the registry's ambitions).

## What already exists

Verified against this tree (`worktree-cloud-env`); the four research passes
behind these citations are summarized here rather than re-derived later.

**Worktree CLI (Tracks A–C of the control-surface plan, shipped).**
`bin/worktrees list --json` emits
`{name, branch, path, box, url, git:{ahead,dirty,merged}, runtime, agent:{state,reason}}`
(`bin/worktrees:213-222`); `git.merged` is `true|false|null` — "could not
tell" is never coerced (`bin/worktrees:190-192`). Liveness is tri-state via
`wt_other_agent_live` (`bin/lib/worktree-teardown.sh:183-300`); `unknown`
counts as live everywhere. **Reuse: every new command and the /ide/ page
consume this; nothing re-derives state.**

**`create` is idempotent and takes any ref.** An already-registered worktree
takes the resume branch (`bin/lib/worktree-create.sh:114-119`); `--base-ref`
is passed straight to `git worktree add`, so an arbitrary SHA works today
(`bin/lib/worktree-create.sh:120-125`, `bin/worktrees:51`). If branch
`worktree-<name>` still exists, create re-attaches to it and ignores
`--base-ref`. **Reuse: recreate is `create` plus a recorded SHA — no new
creation path.**

**Removal trash-mvs and records nothing.** `wt_remove_now`
(`bin/lib/worktree-teardown.sh:459-485`) stops router processes, trash-mvs the
worktree and box, then `git branch -D`. **No final SHA is recorded anywhere**
— `wt_log` logs branch *name* only. This is the one hard gap for
recreate-from-where-it-ended; Track A closes it.

**Launcher: creation + tab spawn, no state.** `bin/launch-worktree-session`
derives a deterministic emoji title (`:105-110`), writes a per-launch script,
and spawns a Terminal.app tab via `osascript 'do script'` (`:290-296` —
create-only; Terminal.app tabs are never found or focused today; the title is
set by an OSC escape from *inside* the tab, not tracked by AppleScript). The
claude path execs `claude --worktree "$wt" --name "$session_name" …`; the
codex path calls `bin/worktrees create` then runs codex foreground and fires
`bin/codex-session-end` on exit. **Reuse: resume/focus reuse the launcher's
tab-spawn and per-agent script generation, refactored into a sourced lib —
not duplicated (§8).**

**Session ids flow past us today and are dropped.** `session-end.sh:35`
extracts `session_id` for a log line only. Claude Code's SessionStart hook
receives `{session_id, transcript_path, cwd, source, …}` on stdin, and
`claude --resume <session-id>` works **from any directory** and restores the
full conversation (v2.1.223+; code.claude.com/docs/en/sessions.md). Codex
stores sessions under `~/.codex/sessions/YYYY/MM/DD/` and the established
recipe is `cd <worktree> && codex resume --last …` — already printed to the
human by `bin/codex-session-end:123`. **Reuse: the registry is new; every
mechanism it records already exists.**

**State-dir pattern.** `$WT_STATE_DIR` (`CALLBACK_STATE_DIR`-overridable,
`bin/lib/worktree-paths.sh:34`) holds per-worktree `pids/<name>.json`,
`logs/<name>.log`, `browse/<name>/`. **Reuse: the registry is
`sessions/<name>.json` in the same pattern; `worktree-cleanup.log`'s
fixed-path-outside-anything-teardown-deletes discipline is the template for
state that must survive removal.**

**Router: top-level routes, auth tiers, and the CSP wall.** Router-infra
paths are hardcoded ahead of worktree dispatch in `bin/router.ts:916-1067`
AND classified in `classifyRouterRoute` (`bin/router-auth.ts:216-285`) — an
unrecognized first segment is treated as a worktree name, so `/ide/` must be
special-cased in **both** places or it auth-classifies as a box route against
a worktree literally named `ide`. Two auth tiers exist: `control-read` (owner
session — a valid, non-revoked cookie for `getOwnerEmail()`,
`bin/router-auth-deps.ts:85-90`) and `control` (owner session + CSRF via
Sec-Fetch-Site/Origin, `bin/router-auth.ts:331-343`) — `/__router/stop` and
`/retry` are the mutating-POST precedent. All `/dev/` content is served with
`Content-Security-Policy: sandbox` (`bin/router-docs.ts:859`) — no JS. The
issues browser is server-rendered HTML with `<a href>` facets and no client
JS (`bin/router-issues.ts:768-959`), mounted inside `serveDev`
(`bin/router-docs.ts:898-905`) but always reading main's issues. The router
already execas fixed read-only git commands per request
(`bin/router-issues.ts:373-406`) but has **no pattern for action-triggering
commands from a web request** — that's new territory with new security
design (Track D). **Reuse: serveIssues moves intact; /ide/ pages are
server-rendered + POST forms in the issues-browser style, which sidesteps the
CSP problem entirely.**

**Plans corpus.** 48 files in `docs/plans/`, zero YAML frontmatter; 36 have
some form of the prose `**Status:**` line (2 of 11 sampled deviate from the
exact form); 6 have "Issues addressed". `doc-check`
(`callback-box/src/dev/doc-check.ts`) validates the link graph and issue
basename uniqueness but parses no frontmatter; the real `yaml` package and a
fence-splitter already live in `callback-box` (`src/cards/frontmatter.ts:39`,
`src/core/card-io.ts:266`). `bin/router-issues.ts:76-124` has a deliberate
hand-rolled subset parser for issues. `/finish` step 6 does the three-way
plan disposition and step 7b reads the prose "Issues addressed" list
(`.claude/agents/finish.md:327-353, 382-435`). No `branch:` or `worktree:`
frontmatter field exists anywhere. **Track E builds on the `yaml`-package
side for validation and extends the router's subset parser only as far as
the new scalar fields need.**

## Prior art (external)

- **Claude Code session resume across directories** — documented, v2.1.223+:
  resume searches the current project, its worktrees, then all projects
  ([sessions doc](https://code.claude.com/docs/en/sessions.md)). SessionStart
  hook payload fields documented in the
  [hooks reference](https://code.claude.com/docs/en/hooks.md).
- **Worktree isolation has no off-switch for interactive sessions.**
  [anthropics/claude-code#50109](https://github.com/anthropics/claude-code/issues/50109)
  (a disable flag) is closed-as-duplicate, unimplemented; only background
  sessions have `worktree.bgIsolation: "none"`
  ([#59580](https://github.com/anthropics/claude-code/issues/59580), itself
  undocumented). Consequence: the plan treats isolation as fixed and designs
  around it — /ide/ actions run in the *router* process, which isolation
  does not constrain, and `bin/land` remains the cross-checkout escape hatch.
  A `watch/` issue records the trigger (Track F).
- **Codex resume**: sessions in `~/.codex/sessions/YYYY/MM/DD/`;
  `codex resume --last` from the worktree cwd is the recipe this repo already
  prints. By-id scripted resume is unconfirmed — the plan uses `--last` only.
- **Terminal.app scripting**: tabs expose a `tty` property to AppleScript;
  `do script` is create-only (already learned at
  `bin/launch-worktree-session:283-289`). Matching a tab by recorded tty is
  the standard technique for find-and-focus (no repo precedent; widely used
  pattern in Terminal automation). iTerm2/kitty have richer APIs — out of
  scope; the adapter isolates the choice.
- **Orchestrator survey** — already done in
  [worktree-control-surface.md](worktree-control-surface.md) (Conductor,
  Claude Squad, Vibe Kanban, desktop app: all monoliths; rejected). Not
  repeated.

## Vocabulary lock-ins (whole plan)

- **`/ide/`** is the top-level, non-worktree-bound dev app. One segment,
  sibling of `/__router/*` in both dispatch and auth classification.
- **`session registry`** = `$WT_STATE_DIR/sessions/<name>.json`, one file per
  worktree name. A *hint store*, never a source of truth: every consumer
  falls back cleanly when a file is missing or stale.
- **`cull`** = the existing merged+clean+no-agent removal (sweep/session-end).
  No new eligibility rules; culls now leave a record.
- **`recreate`** = `bin/worktrees create` driven from a cull record. Not a new
  command implementation, a new entry point into the existing one.
- New `bin/worktrees` subcommands: `focus`, `resume`, `close`. `resume` is
  the umbrella motion (focus if live, reopen if not, recreate if culled);
  `focus` and `close` are the narrow verbs. `remove` and `down` keep their
  locked meanings from the control-surface plan.

## Tracks / scope

Ordered by implementation dependency. A (registry) unblocks B (resume/focus)
and C (cull/recreate); D (/ide/) fronts A–C; E (frontmatter) is independent
until its /ide/ view; F is paperwork.

### Track A — the session registry

**What.** `$WT_STATE_DIR/sessions/<name>.json`, written at launch and at
SessionStart, enriched at cull time. Bash + jq, atomic (write temp, `mv`),
following the `pids/<name>.json` pattern. A new sourced lib
`bin/lib/session-registry.sh` owns read/merge/write; nothing else touches the
files directly (§8).

**Why.** Three consumers need a durable worktree→session mapping that
nothing records today: `resume` (which conversation), `focus` (which tty),
recreate (which final SHA). The transcript files themselves persist; only the
*mapping* is missing.

**Direction.** Record shape (all fields optional except `name`,
`updatedAt`; consumers must tolerate absence):

```jsonc
{
  "name": "seam",
  "branch": "worktree-seam",
  "agent": "claude",                  // claude | codex — last agent launched
  "sessionId": "3f2a…",               // claude only; codex resumes via --last
  "transcriptPath": "/…/.claude/projects/…/3f2a….jsonl",
  "model": "opus",                    // as passed at launch; absent if default
  "tty": "/dev/ttys012",              // the tab's tty, for focus
  "launchedAt": "2026-08-09T18:20:00Z",
  "updatedAt": "2026-08-09T18:20:00Z",
  "culled": {                         // present only after a cull
    "at": "2026-08-10T02:11:00Z",
    "finalSha": "bd6fe693…",          // branch tip before git branch -D
    "merged": true
  }
}
```

Writers:

1. **`bin/launch-worktree-session`** — at launch, both agent paths write
   `{name, branch, agent, model, tty, launchedAt}`. The launcher script runs
   *inside* the tab, so `tty` is just `$(tty)`. Codex gets no further writes
   (no hooks); this launch record is its whole entry.
2. **A new SessionStart hook** (`.claude/hooks/session-start-registry.sh`,
   added to the existing `SessionStart` array in `.claude/settings.json`) —
   resolves its worktree the same way `session-end.sh:66-89` does (cwd under
   `$WT_ROOT`, else transcript-path parsing), and if resolved, merges
   `{agent: "claude", sessionId, transcriptPath, tty, updatedAt}`. `tty` from
   the hook's own controlling terminal (`ps -o tty= -p $$`), which the tab's
   shell passed down. A session that resolves to no worktree (main sessions)
   writes nothing. Fires on `source: resume|clear|compact|fork` too — the
   *latest* session id wins, which is the semantics resume wants. Must exit 0
   always; a registry failure never blocks a session (the existing
   `auto-sweep.sh` non-blocking discipline).
3. **Cull enrichment** — `wt_remove_now` (`bin/lib/worktree-teardown.sh:459`)
   captures `git -C <path> rev-parse HEAD` *before* trash-mv and branch
   delete, and merges `culled: {at, finalSha, merged}` into the registry file.
   The registry lives outside everything teardown deletes, so the record
   survives its worktree — that is the point.

Retention: registry files for culled worktrees are pruned by `sweep` after 90
days (one `find -mtime` line in the existing state-prune pass,
`bin/worktrees:~440`), matching "hint, not archive".

`bin/worktrees list --json` gains an additive `session` field per row —
`{agent, hasSession, tty, culled}` pulled from the registry — so /ide/ and
any client join it without reading registry files themselves. Additive only;
the locked Track C contract fields do not change.

**First implementation chunk.** `bin/lib/session-registry.sh` (read/merge/
write/prune) + the launcher writes + a doctest asserting shape, atomicity
(concurrent merge doesn't lose fields), and absent-file behavior. No hook
yet, no consumers — complete and inert on its own.

### Track B — `focus`, `resume`, `close`

**What.** The three motions over the registry, as `bin/worktrees`
subcommands, agent-neutral by construction.

**Why.** This is the missing workflow: getting back to a closed session, and
closing one confidently. The control-surface plan designed `resume` and
deferred it precisely because it is a workflow change; the boxholder has now
asked for the workflow change, with conversation reattachment (revising that
plan's "fresh context first" lean — its own text says "revisit once resume
is in daily use"; daily use is what's being built).

**Direction.**

```
bin/worktrees focus  <name>                 # bring the live tab to front
bin/worktrees resume <name> [--agent claude|codex] [--fresh] [--at-final-sha]
bin/worktrees close  <name> [--force]
```

- **`focus`**: read `tty` from the registry; verify a live `claude`/`codex`
  process actually has that tty (`ps -o tty=` over the liveness snapshot —
  ttys are reused after tabs close, so the registry tty alone is not
  trusted); then AppleScript: select the Terminal.app tab whose `tty`
  matches, raise its window, `activate`. No live process on that tty →
  print "no live session — use resume" and exit 1. The AppleScript lives in
  one adapter function (`bin/lib/terminal-tabs.sh`) so a future terminal swap
  touches one file.
- **`resume`** decides by state, in order:
  1. Live agent in the worktree → delegate to `focus`.
  2. Worktree exists, no live agent → open a new tab (reusing the launcher's
     tab-spawn + per-agent script generation, extracted into
     `bin/lib/launch-session.sh` and sourced by both callers — the launcher
     itself becomes a thin arg-parsing client, same refactor shape as the
     hook→CLI move). The tab runs, for claude:
     `cd "$MONO" && claude --resume <sessionId>` when the registry has one
     (full conversation restored), else a fresh
     `claude --worktree <name>` with a generated continuation prompt. For
     codex: `cd <worktree> && codex resume --last <established flags>` when
     the registry says codex, else fresh. `--fresh` forces the no-reattach
     path. `--agent` overrides the registry; required when no registry entry
     exists (the control-surface rule, kept).
  3. Worktree culled (no dir; registry has `culled`) → `bin/worktrees create
     <name>` from **main** (default), then open a fresh session whose
     continuation prompt includes the cull context: the branch's final SHA
     and `git log --oneline <finalSha>..main` (capped at 50 lines) — "here
     is what landed since this workstream last existed." `--at-final-sha`
     instead recreates via `create <name> --base-ref <finalSha>` for the
     rare case where the old tree state itself matters. If a claude
     `sessionId` survives in the registry, try `claude --resume <sessionId>`
     first — the transcript outlives the worktree, and resume works from any
     directory; fall back to fresh-with-context if it errors (see failure
     modes).
  4. No worktree, no registry → error: "unknown worktree; use
     launch-worktree-session to start new work." `resume` never creates
     net-new workstreams — creation stays session-driven per the boxholder's
     stated workflow.
- **`close`**: the guarded way to end a merged session. Refuses unless
  merged+clean (same `wt_work_state` gates as `remove`; `--force` overrides
  those two, never liveness-unknown). Mechanism: AppleScript `close` on the
  tab found by tty (Terminal.app prompts if the process resists; acceptable).
  The agent process ends → the existing SessionEnd hook / next sweep culls
  the worktree through the already-shipped path. `close` adds **no new
  removal logic** — it ends the session and lets the existing lifecycle
  collect (§8).

**Vocabulary lock-in.** `resume` is the one user-facing "get back to it"
verb; `focus`/`close` are the narrow verbs; help text spells out the
delegation so an agent at a prompt picks right.

**First implementation chunk.** Extract `bin/lib/launch-session.sh` from
`bin/launch-worktree-session` (pure refactor, launcher behavior unchanged,
verified by launching one session each way) — this is the §8-critical move
that everything else composes with.

### Track C — cull records and the front-page contract

**What.** The glue that makes culling invisible-but-reversible: the Track A
cull enrichment (finalSha) feeding the Track B recreate path, plus the
decision of what /ide/ shows.

**Why.** Today a merged worktree lingers only because a live tab pins it;
once `close` exists, culls become routine, and a cull without a record is a
dead end.

**Direction.** The /ide/ front page (Track D) lists three strata from
`list --json` + `session`:

1. **In progress** — unmerged, dirty, or live-agent worktrees. The main
   list. Buttons: focus (live) / resume (not live).
2. **Merged, session still open** — `merged && agent.state == live`. Flagged
   "close freely"; button: close.
3. **Recently culled** — registry-only entries with `culled` (worktree dir
   gone), newest first, capped at 15. Button: resume (which recreates).
   These do NOT appear in stratum 1 — a culled worktree has nothing unique,
   which is exactly why it was culled.

Sweep behavior is unchanged (eligibility rules stay locked per the
control-surface plan); the only sweep addition is registry pruning (Track A)
and the finalSha capture inside `wt_remove_now`.

**First implementation chunk.** The `wt_remove_now` finalSha capture + a
doctest: remove a merged worktree, assert the registry gained
`culled.finalSha` equal to the pre-removal HEAD, then `create --base-ref
<that sha>` reproduces the tree.

### Track D — the /ide/ router app

**What.** The web surface: `/ide/` (front page), `/ide/issues/` (the moved
issues browser), `/ide/plans/` (Track E's view), and POST action endpoints
that run the Track B commands.

**Why.** "One page that shows what's outstanding" is the boxholder's stated
pain; the issues browser is main's-issues-regardless-of-prefix already —
its current `/main/dev/issues/` address is a lie about what it is (§7).

**Direction.**

- **Routing:** add `/ide` handling in `router.ts`'s requestListener ahead of
  `parseWorktreeName` (sibling of the `/__router/*` block,
  `bin/router.ts:916-1067`), delegating to a new `bin/router-ide.ts`
  (one-way import from router.ts, same discipline as `router-docs.ts`,
  `bin/CLAUDE.md:76-79`). Add matching cases in `classifyRouterRoute`
  (`bin/router-auth.ts:216-285`): GET/HEAD under `/ide` → `control-read`;
  POST `/ide/action/*` → `control`. Never serve /ide/ through the `/dev/`
  pipeline — it gets its own handler and its own CSP (`default-src 'none';
  style-src 'unsafe-inline'` to start; no scripts needed).
- **Rendering:** server-rendered HTML + `<form method="POST">` buttons,
  exactly the issues-browser + `/__router/stop` precedent. No client JS in
  v1 — this is what makes the CSP trivial and keeps the app one file.
  Auto-refresh via `<meta http-equiv="refresh" content="30">` on the front
  page (crude, sufficient, no-JS).
- **Front page data:** the router execas `bin/worktrees list --json`
  (timeout 10s) rather than re-deriving state in TypeScript — the bash
  implementation is the single liveness authority (the control-surface plan
  settled this exact question in favor of bash for exactly this reason; a TS
  re-derivation would be the fail-open duplication again). Render the three
  strata from Track C.
- **Action endpoints:** `POST /ide/action/{focus|resume|close|recreate}/<name>`
  → execa `bin/worktrees <verb> <name>` with `<name>` validated by the same
  `[a-zA-Z0-9_-]+` rule as `wt_paths_valid_name` *before* building argv, no
  other request data reaching the command line. Response: 303 back to `/ide/`
  with a flash message (query param) reporting the command's first stderr
  line on failure. Security posture: these endpoints execute fixed local
  commands, so they are `control` (owner session + CSRF) **and** the plan
  accepts that a Tailscale-exposed router lets the owner's phone open a tab
  on the Mac — that is the feature, not a leak; a non-owner or cross-site
  request never reaches dispatch (`bin/router.ts:894-914` chokepoint). The
  spoof wall and `CB_HUB_SECRET` deletion already in place stay untouched.
- **Issues browser move:** mount `serveIssues` at `/ide/issues/` (it already
  takes `base` as a parameter, `bin/router-issues.ts` interface); change the
  router index link (`bin/router.ts:709`); 301 `/<name>/dev/issues/*` →
  `/ide/issues/*` (kept indefinitely — one line, and habit + docs point
  there). Grep tracked files for `dev/issues` links and update them.
- **osascript from the router:** the router process needs macOS Automation
  permission for Terminal.app the first time an action fires (TCC prompt on
  the Mac). This is a one-time grant; the first-chunk test exercises it
  deliberately so the prompt happens during implementation, not during real
  use. If denied, actions fail with the osascript error surfaced in the
  flash message — loud, not silent (§4).
- **Dev friction, stated plainly:** /ide/ lives in `bin/router*.ts`, so the
  implementing session tests against an isolated router
  (`CALLBACK_STATE_DIR` + `ROUTER_PORT`, `bin/CLAUDE.md:252`) and the live
  router picks the app up only after main-merge + boxholder-driven `pnpm dev`
  restart. The plan ships dark until that restart.

**First implementation chunk.** Route wiring + auth classification + a
read-only front page (three strata, no buttons), with a doctest against the
isolated router asserting: `/ide/` 200s for an owner session, 403s without,
and an unknown first segment still 404s as before (no regression in worktree
dispatch).

### Track E — plan/issue frontmatter and the plans view

**What.** YAML frontmatter for `docs/plans/*` (and the two sibling dirs),
migration of the 48-file corpus, doc-check validation, a `branch:` field on
issues, `/finish` + cb-plan updates, and `/ide/plans/`.

**Why.** 44+ active plans, 0 machine-readable; the plan↔issue join exists in
3 of 44 files as prose. The /ide/ views need to answer "which plans are in
flight and from which branch" without an agent reading 19k lines (§11, §12 —
enforcement over convention; the maintainer is an agent).

**Direction.**

- **Plan frontmatter schema** (deliberately minimal, mirroring issues/):

  ```yaml
  ---
  title: "An agent-neutral worktree control surface"
  status: active        # draft | active | partial | implemented | superseded | parked
  branch: worktree-seam # the worktree branch that carried the work; omit if none
  issues:               # machine-readable "Issues addressed"
    - ../../issues/features/2026-08-08-worktree-session-workflow-redesign.md
  superseded-by: other-plan.md   # only with status: superseded
  ---
  ```

  The prose `**Status:** …` first line is **replaced**, not duplicated — two
  status encodings would drift (§8). `docs/plans/README.md` is rewritten to
  document the frontmatter as the convention. Body H1 stays (unlike issues/)
  — plans are long documents read as documents.
- **Migration:** one mechanical pass over all 48 + implemented-plans/ +
  unimplemented-plans/ (status derivable from directory + existing prose
  line; `issues:` populated only where an "Issues addressed" section already
  names them; `branch:` left absent historically). Lands in the same commit
  as the validator so there is no bilingual window.
- **Validation in doc-check:** a new check in
  `callback-box/src/dev/doc-check.ts` using the `yaml` package + a
  fence-splitter patterned on `src/cards/frontmatter.ts:39` (NOT the
  router's hand-rolled parser — that one stays deliberately minimal for
  rendering). Enforces: frontmatter present on every file under the three
  plan dirs, `status` in the enum and consistent with the directory
  (implemented-plans/ ⇒ implemented; unimplemented-plans/ ⇒
  superseded|parked), `issues:` paths resolve (they join the existing link
  graph, so `doc-check --fix` heals them on issue moves for free),
  `superseded-by` only with the matching status. Issues gain an *optional*
  `branch:` scalar — validated as `worktree-[a-zA-Z0-9_-]+` when present,
  never required.
- **`/finish` integration:** step 6 writes `status:` frontmatter instead of
  the prose line; step 7b reads `issues:` (falling back to the prose section
  during the long tail of unmigrated habits); when marking a plan `partial`,
  /finish **surfaces** the leftover work as a proposed issue body in its
  report rather than auto-filing (the plan-lifecycle issue's open question,
  resolved toward "surface, don't perform" — auto-filed fragments are how
  the queue fills with items nobody chose; agents arrange context, humans
  keep judgment). cb-plan's template adds the frontmatter block; the
  "Issues addressed" prose section stays as the human-readable rendering of
  the same list.
- **`/ide/plans/`:** a read-only server-rendered list — status facets,
  branch column joined against `list --json` (a plan whose branch has a live
  worktree links to its front-page row), each plan linking to the existing
  `/main/dev/docs/` rendering of the file. Small: it is the issues browser's
  shape over a 50-file corpus.
- **Who stamps `branch:`?** cb-plan writes it at plan-creation time (the
  session knows its own branch); /finish stamps it on issues it closes or
  flags. Free-text `discovered-in:` stays for prose color; `branch:` is the
  queryable field.

**First implementation chunk.** The doc-check validator + the 48-file
migration in one commit (validator green over the migrated corpus is the
test), touching no consumer yet.

### Track F — record what this plan decided elsewhere

- File `issues/watch/2026-08-09-claude-worktree-isolation-off-switch.md`:
  trigger = upstream ships a disable flag
  (anthropics/claude-code#50109 or successor); when it fires, revisit
  whether `bin/land` and the /ide/-actions-run-in-the-router arrangement
  should simplify.
- Update the two addressed issues to point `design:` at this plan.
- Correct the redesign issue's "Gaps" section (the resume path and status
  join now have a design home).

## Could this be simpler?

**Simplest plausible version:** no /ide/ at all. Ship only Tracks A+B —
registry + `resume`/`focus`/`close` as CLI — and keep using
`/main/dev/issues/` where it is. That alone makes tabs disposable: close
freely, `bin/worktrees resume <name>` from any prompt.

What the fuller plan buys, concretely:

- **Track D (the app)** buys the *seeing* half of the boxholder's ask —
  "what worktrees are actually in progress" has no answer at a glance from a
  CLI you have to remember to run, and the phone/browser case (the buttons)
  doesn't exist at all without it. This is the JTBD itself, not polish.
- **The issues-browser move** buys truthful addressing (§7): the browser
  already ignores its worktree prefix; /ide/ is what it already is.
- **Track E** buys the join the views need — without frontmatter,
  `/ide/plans/` would be another prose-scraping renderer, extending the
  drift §11 exists to stop.
- **Track C's cull records** buy reversibility for a motion (`close`) the
  simple version also ships — shipping `close` *without* the record makes
  culling feel lossy again, which recreates the original tab-hoarding.

Genuinely at risk of over-building, and trimmed: no client-side JS, no live
WebSocket status, no session-history browser (latest session only), no
multi-terminal support, no new sweep rules, no auto-filed issues. Each cut
traces to *stop over-engineering rare failures* / "arrange context, don't
automate judgment".

## Subplans

None. The one candidate — the plan-frontmatter schema — is small enough that
its decision table is inline in Track E; splitting it would manufacture a
dependency (`/ide/plans/` waiting on a subplan) with no open research
question to justify it.

## Failure modes

> **Critical gap — accepted as documented risk:** `claude --resume
> <sessionId>` reattaching a conversation whose session ran under
> `--worktree` is documented for the general case but unverified for the
> worktree case (does the resumed session re-enter worktree isolation? does
> it resolve the same worktree by name?). Chunk B2 verifies this empirically
> **before** any dependent code lands; if it fails, resume degrades to
> fresh-with-continuation-context everywhere and the registry's `sessionId`
> becomes claude-picker assistance only. The plan is written so that
> downgrade changes one branch in `resume`, nothing else.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| SessionStart hook can't resolve its worktree (main session, hand-launched odd cwd) | To add — hook doctest with main-checkout cwd | By design — writes nothing, exits 0 | Clear in behavior: no registry entry ⇒ `resume` requires `--agent`, fresh context |
| Registry sessionId is stale (transcript pruned, `/clear` created a new id after last write) | To add — resume with a bogus id | To add — `resume` pre-checks `transcriptPath` exists; on in-tab `claude --resume` failure the tab shows claude's own error; wrapper falls back to fresh after printing it | Clear: error visible in the opened tab, fallback stated |
| tty reused by an unrelated tab after close | To add — focus with a dead-process tty | Yes by design — focus verifies a live claude/codex on that tty before AppleScripting | Clear: "no live session — use resume" |
| Two concurrent sessions in one worktree | Not tested — hint semantics | Last-writer-wins on `updatedAt`; `resume` reattaches the latest | Acceptable by design; registry is a hint, and `focus` still finds whichever tty is live |
| `wt_remove_now` can't read HEAD before delete (corrupt worktree) | To add — remove with a broken .git | To add — record `culled` without `finalSha`; recreate then works from main only and says why | Clear: recreate prints "no final SHA recorded" |
| Pre-plan culls (no registry file at all) | Covered by absent-file doctest | Yes — stratum 3 simply doesn't list them; `resume` on them is the "unknown worktree" error | Clear |
| Router action execa times out / bin missing | To add — action doctest with a stubbed failing command | To add — 303 with flash carrying first stderr line; router never blocks on an action (10s timeout, killGroup) | Clear: flash message |
| osascript lacks Automation permission (TCC) | Exercised deliberately in chunk D2 on the real Mac | Error surfaces in flash / CLI stderr | Clear |
| `/ide` unknown-segment regression (auth misclassification) | To add — doctest: `/ide` owner-gated, `/idex` still 404s as worktree | Wiring in both dispatch and classifier per Track D | Clear |
| Recreated-from-main worktree is instantly sweep-eligible (ahead=0, clean) before its session launches | To add — recreate doctest races sweep | Handled by ordering — `resume` creates and launches in one flow; the launched agent pins it within seconds. Residual race accepted (sweep runs on session lifecycle events, not a timer) | Documented here; near-nil reachability on the real path |
| Plan frontmatter migration misses a file / wrong enum | Validator IS the test — doc-check red until corpus clean | Same commit, no bilingual window | Clear: doc-check names the file |
| `/finish` writes prose status out of habit (stale agent behavior) | doc-check catches the missing/duplicated status on its commit | finish.md edited in the same track | Clear: pre-commit fails |

## Agent-flow / user-flow edge cases

- **Wrong verb** (`close` when `remove` was meant, `resume` to start new
  work) — **ADDRESSED**: `close` shares `remove`'s refusal gates so the
  worst case is a refusal with reasons; `resume` on an unknown name refuses
  and names `launch-worktree-session` (Track B step 4).
- **Stale ref** — **ADDRESSED**: every registry consumer treats absence/
  staleness as "fall back and say so" (failure-modes rows 2, 3, 6); `issues:`
  frontmatter paths join the doc-check link graph so issue moves heal them
  (`doc-check --fix`, Track E).
- **Two agents, same worktree** — **ADDRESSED** for safety by the untouched
  tri-state liveness guards; for the registry, last-writer-wins is
  documented hint semantics (failure-modes row 4).
- **Hand-edit drift** (hand-made worktree, hand-edited registry JSON) —
  **ADDRESSED**: hand-made worktrees appear in `list` from disk with no
  `session` field and `resume` demands `--agent` (control-surface behavior,
  kept); a corrupt registry JSON is treated as absent by
  `session-registry.sh` (jq parse failure → warn to stderr, proceed as
  missing — never abort a lifecycle operation on a hint file, §4's
  "degrade visibly").
- **Fabricated free-form value** — **ADDRESSED by design**: every registry
  field is written by the launcher/hook from its own process facts (tty,
  session_id from the harness); no model-authored field exists. Plan
  frontmatter `status:` is agent-written but validator-enforced against the
  directory (Track E), which is the honesty mechanism.
- **Validation error UX** — **ADDRESSED**: doc-check failures name file and
  field; `bin/worktrees` refusals print which gate blocked and the resolved
  path (control-surface convention, extended to the three new verbs);
  /ide/ flash messages carry the command's stderr line.
- **Partial migration / transition state** — **ADDRESSED**: the only
  data-shape change (plan frontmatter) migrates corpus + validator + writer
  in one track with no bilingual window; the registry is created-on-write
  with absence as a fully-defined state, so pre-existing worktrees need no
  backfill, ever.

## NOT in scope

- **Disabling Claude Code worktree isolation** — no supported mechanism
  exists (Prior art); recorded as a `watch/` issue, designed around.
- **A terminal switch (iTerm2/kitty/WezTerm)** — Terminal.app suffices for
  spawn/focus/close via the tty technique; the one adapter file
  (`bin/lib/terminal-tabs.sh`) is the seam if this changes. Deciding a
  terminal now would be a preference change smuggled into a tooling plan.
- **tmux / tty multiplexers / in-terminal switchers** — boxholder-rejected,
  standing.
- **Client-side JS in /ide/, live-updating status, WebSockets** — the no-JS
  server-rendered shape meets the JTBD; interactivity beyond POST forms is
  complexity with no named buyer yet.
- **Session *history* (resuming anything but the latest session)** — the
  claude picker (`claude --resume` bare) already serves the archaeology
  case; the registry records latest-only on purpose.
- **Codex resume-by-id** — unconfirmed upstream; `--last` from the worktree
  cwd is the recipe and suffices.
- **Auto-filing issues from partial plans** — /finish surfaces a proposed
  body; a human files (Track E, "arrange context, don't automate judgment").
- **Any expansion of `needs: [manual-testing]` flows** — the overuse
  decision is open; /ide/issues/ inherits the existing facet untouched.
- **Box forking / pointing engines at real boxes** — blocked on the
  events.db bug; stays in the redesign issue.
- **Conductor or any packaged frontend** — the seam keeps them cheap to try;
  trying them is not this plan.
- **A `remove` button on /ide/** — destructive-beyond-close stays at the
  CLI where the refusal output is fully visible.

## Open design questions

- **Does `claude --resume <id>` fully restore a `--worktree` session?**
  (isolation, worktree binding). The load-bearing unknown; verified
  empirically in chunk B2 before dependents land. Lean: works, given
  documented full-state restore; the degradation path is pre-designed
  (critical-gap note above).
- **Should `close` also be offered for *unmerged* worktrees as "pause"?**
  Lean: yes but later — closing an unmerged session is already safe (sweep
  won't touch unmerged worktrees; `resume` reopens), so it needs no code,
  only the front page eventually showing paused-unmerged rows distinctly.
  Revisit after daily use.
- **Registry pruning window (90 days)** — arbitrary; adjust after seeing
  real cull-to-resume gaps. Not load-bearing (pruned entry ⇒ recreate from
  main without context, clearly stated).
- **Should `/ide/` get a link on the router index page's nav beyond
  replacing the issues link?** Lean: yes, one line; decided at
  implementation.

## Knowledge audits

**Skip, with rationale.** Everything here is dev-repo tooling — invisible to
box agents, whom knowledge audits test (`docs/knowledge-audits.md`). The
agent-facing surfaces created (the three subcommands, the registry contract,
plan frontmatter) are documented for *dev* agents in `bin/CLAUDE.md` and
`docs/plans/README.md`, and enforced by doc-check + refusal messages rather
than recall (§11) — the same disposition the control-surface plan recorded.

## Implementation order

Each chunk is a commit or a few related commits; all land before the plan
ships. Codex-implementable: no chunk contains an open question.

1. **A1 — registry lib + launcher writes** (`bin/lib/session-registry.sh`,
   both launcher paths, doctest for shape/atomicity/absence).
2. **A2 — SessionStart registry hook** (worktree resolution shared with
   session-end.sh — extract the transcript-path parser into a lib function
   rather than copying it; hook wired into settings.json). Depends on A1.
3. **B1 — launcher refactor** (`bin/lib/launch-session.sh` extraction; pure
   refactor, behavior-identical).
4. **B2 — the resume verification spike**: with A1+A2 live, close a real
   worktree session and run `claude --resume <recorded id>` from `$MONO`;
   record the outcome IN THIS PLAN (edit this doc) and pick the resume
   branch accordingly. Gate for B3.
5. **B3 — `focus` + `close`** (`bin/lib/terminal-tabs.sh` adapter, tty
   verification, gates). Depends on A1.
6. **B4 — `resume`** (four-state dispatch, continuation-prompt generation).
   Depends on B1–B3, C1.
7. **C1 — cull finalSha capture** in `wt_remove_now` + recreate doctest.
   Depends on A1. (Can land right after A1; listed here for narrative order
   — do it early.)
8. **C2 — `list --json` `session` field** (additive). Depends on A1.
9. **D1 — /ide/ wiring + read-only front page** (routes, auth classes, three
   strata, doctests incl. no-regression on worktree dispatch). Depends on C2.
10. **D2 — action endpoints** (POST forms, name validation, flash errors,
    TCC exercised). Depends on B3/B4, D1.
11. **D3 — issues browser move** (mount at /ide/issues/, 301s, link sweep).
    Depends on D1 only.
12. **E1 — plan frontmatter: validator + 48-file migration**, one commit.
13. **E2 — /finish + cb-plan updates** (frontmatter writer, `issues:`
    reader, surface-don't-file for partials, `branch:` stamping). Depends on
    E1.
14. **E3 — `/ide/plans/` view + issue `branch:` validation**. Depends on
    D1, E1.
15. **F — watch issue, `design:` links, redesign-issue gap corrections,
    `bin/CLAUDE.md` + `docs/plans/README.md` + `dev/README.md` docs.**

## Rollout shape

- **Test posture.** Named per chunk above; the done-when is those assertions
  passing plus one end-to-end rehearsal on the real machine: launch → close
  (tab gone) → front page shows culled → resume → conversation restored (or
  the B2-downgrade equivalent), performed once by the implementing session
  and once by the boxholder (this is the only intentionally-manual step —
  it exercises TCC and Terminal.app, which no doctest can).
- **Ships dark, lights on restart.** Everything lands on the worktree
  branch; `/finish` merges; the live router serves /ide/ only after the
  boxholder restarts `pnpm dev` (never from a worktree session,
  `bin/CLAUDE.md`). CLI verbs and the registry work immediately on merge.
- **Migration.** Plan-frontmatter corpus migration is atomic with its
  validator (E1). The registry needs no migration by construction (absence
  is defined). No box data is touched anywhere in this plan.
- **Cross-model review** (`/cross-model`) runs on this plan before
  implementation starts, and on the diff before the plan is called done —
  it defines a state contract (registry), a web surface with an auth
  posture, and a repo-wide frontmatter vocabulary, all squarely over the
  bar.
