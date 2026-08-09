# The /workstreams/ app and disposable sessions

**Status:** active — designed 2026-08-09, not yet implemented; written for Codex
implementation.

A new top-level router app at `/workstreams/` — a development control surface
that is not worktree-bound — plus the lifecycle machinery it fronts: a
workstream registry, terminal focus/resume/close commands, cull records that
make merged worktrees recreatable, and machine-readable plan/issue
frontmatter. The goal: a terminal tab stops being the only record of work in
flight, so sessions become disposable. (A **workstream** is the durable unit
— a named line of work plus its conversation; its **worktree** is just the
checkout currently attached to it. See Vocabulary lock-ins.)

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
  primary creation path; /workstreams/ is for seeing and returning, not for starting.)

## Stated preferences this plan trades against

- `docs/engineering-principles.md` §4 (resilient AND never silent — the
  tri-state liveness discipline in front of every destructive action), §7
  (hierarchy is a discoverability contract — /workstreams/ is where non-worktree-bound
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
counts as live everywhere. **Reuse: every new command and the /workstreams/ page
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
`workstreams/<name>.json` in the same pattern; `worktree-cleanup.log`'s
fixed-path-outside-anything-teardown-deletes discipline is the template for
state that must survive removal.**

**Router: top-level routes, auth tiers, and the CSP wall.** Router-infra
paths are hardcoded ahead of worktree dispatch in `bin/router.ts:916-1067`
AND classified in `classifyRouterRoute` (`bin/router-auth.ts:216-285`) — an
unrecognized first segment is treated as a worktree name, so `/workstreams/` must be
special-cased in **both** places or it auth-classifies as a box route against
a worktree literally named `workstreams`. Two auth tiers exist: `control-read` (owner
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
design (Track D). **Reuse: serveIssues moves intact; /workstreams/ pages are
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
  around it — /workstreams/ actions run in the *router* process, which isolation
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

- **`workstream`** — the durable unit: a named line of work plus its
  conversation and records, identified by its short name (e.g. `seam`).
  A workstream outlives any checkout: it exists while its worktree is
  live, while the worktree sits idle, and after the worktree is culled —
  culling detaches storage; it does not end the workstream. This is the
  noun the UI, the schema, and the docs use (boxholder decision,
  2026-08-09; "topic" rejected as too generic, "branch"/"worktree"
  rejected as naming the substrate rather than the unit).
- **`worktree`** — from now on, strictly *the checkout attached to a
  workstream*: a bunch of files. Branch names keep the `worktree-<name>`
  prefix as substrate convention (they name a worktree's branch, which is
  exactly what they are); the word never leaks into the schema or UI.
- **`/workstreams/`** is the top-level, non-worktree-bound dev app. One
  segment, sibling of `/__router/*` in both dispatch and auth
  classification.
- **`workstream registry`** = `$WT_STATE_DIR/workstreams/<name>.json`, one
  file per workstream. A *hint store*, never a source of truth: every
  consumer falls back cleanly when a file is missing or stale.
- **`cull`** = the existing merged+clean+no-agent removal (sweep/
  session-end), which detaches the workstream's worktree. Culls now leave
  a record, and eligibility gains exactly one new rule — the Track G pin:
  **a worktree is cullable only if its box clone is** (no unmerged
  `Test-Content: stock` commits, no open `manual-testing` issue naming the
  workstream); otherwise unchanged.
- **`recreate`** = `create` driven from a cull record — re-attaching a
  worktree to a workstream. Not a new command implementation, a new entry
  point into the existing one.
- **The CLI is renamed `bin/worktrees` → `bin/workstreams`** (subcommands
  unchanged: `create`, `remove`, `list`, `sweep`, `status`, `down`,
  `panic`, plus the new `focus`, `resume`, `close`). The unit the command
  manages is the workstream; worktree creation/removal is its
  storage-management half. All callers and docs update in the same commit;
  no alias or shim is left behind (§8, consolidate over blast-radius
  fear). `resume` is the umbrella motion (focus if live, reopen if not,
  recreate if culled); `focus` and `close` are the narrow verbs; `remove`
  and `down` keep their locked meanings from the control-surface plan.

## Tracks / scope

Ordered by implementation dependency. A (registry) unblocks B (resume/focus)
and C (cull/recreate); D (/workstreams/) fronts A–C; E (frontmatter) is
independent until its /workstreams/ view; G (manual-testing flow) builds on
D + E; F is paperwork (listed last in the doc because it closes the loop).

### Track A — the workstream registry

**What.** `$WT_STATE_DIR/workstreams/<name>.json`, written at launch and at
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
  "removed": {                        // present only after any removal
    "at": "2026-08-10T02:11:00Z",
    "finalSha": "bd6fe693…",          // branch tip before git branch -D
    "merged": true                    // true = a cull; false = forced/manual
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
   resolves its worktree by, in order: **(a) ancestor argv** — walk the
   hook's ppid chain to the nearest `claude` process and match
   `--worktree <name>` in its `ps -o command=` output, the exact signal
   `wt_other_agent_live` already trusts (`bin/lib/worktree-teardown.sh`
   argv discipline); **(b)** cwd under `$WT_ROOT`; **(c)** transcript-path
   parsing per `session-end.sh:66-89`. Ancestor argv is FIRST and
   load-bearing: for launcher-started sessions, `cwd` and `transcript_path`
   are both main-derived (`session-end.sh:43-52` documents exactly this),
   so the fallbacks alone would miss the primary launch path and the
   registry would never capture the sessionId that resume depends on
   (cross-model review finding, 2026-08-09). If resolved, merge
   `{agent: "claude", sessionId, transcriptPath, tty, updatedAt}`. `tty`
   comes from the **same ancestor walk** — NOT from the hook's own process:
   verified empirically 2026-08-09, a hook-style piped child has no
   controlling tty (`ps -o tty=` on itself says `??`) while the `claude`
   ancestor reports the tab's real tty alongside `--worktree <name>` in its
   argv, so one walk yields both facts. A session that resolves to no worktree (main
   sessions) writes nothing. Fires on `source: resume|clear|compact|fork`
   too — the *latest* session id wins, which is the semantics resume wants.
   Must exit 0 always; a registry failure never blocks a session (the
   existing `auto-sweep.sh` non-blocking discipline). Chunk A2's doctest
   asserts specifically the launcher-shaped case: a fake claude ancestor
   with `--worktree foo` in argv and cwd=main resolves to `foo`.
3. **Removal enrichment** — `wt_remove_now` (`bin/lib/worktree-teardown.sh:459`)
   captures `git -C <path> rev-parse HEAD` *before* trash-mv and branch
   delete, and merges `removed: {at, finalSha, merged}` into the registry
   file, where `merged` comes from the caller's already-computed
   `wt_work_state` verdict. **`wt_remove_now` serves forced and manual
   removals too** (`bin/worktrees remove --force`, `codex-session-end`), so
   the field is `removed`, not `culled`: a *cull* is a removal with
   `merged: true`, and only those appear in /workstreams/'s "recently culled"
   stratum — a force-removed dirty worktree must never render as
   safely-reversible (cross-model review finding). The registry lives
   outside everything teardown deletes, so the record survives its worktree
   — that is the point.

Concurrency: the launcher, the SessionStart hook, and removal can race on
one registry file, and temp+`mv` only makes each *write* atomic, not the
read-merge-write sequence. `session-registry.sh` therefore wraps the whole
merge in an `mkdir`-based lock (the `pi_lock` pattern from
`bin/private-issues`, already named as the repo's lock idiom in
[worktree-control-surface.md](worktree-control-surface.md)), with a stale
threshold and a bounded wait; on lock timeout it warns to stderr and skips
the write — a lost hint beats a blocked lifecycle operation (§4).

Retention: registry files whose worktree is gone AND whose `removed.at` is
older than 90 days are pruned by a new, explicit step in `sweep` — this is
deliberately **new** behavior, not a rider on the existing orphan-state
prune: unlike `browse/`/`logs/`/`pids/` orphans, a sessions file with no
worktree is *correct* state (it is the cull record), so the prune keys on
age, never on mere orphanhood.

`bin/worktrees list --json` gains an additive `session` field per row —
`{agent, hasSession, tty, removed}` pulled from the registry — so /workstreams/ and
any client join it without reading registry files themselves. Culled
worktrees have **no directory**, so they are not rows at all under the
current contract (`bin/worktrees:179` loops `$WT_ROOT` dirs); they appear
only under a new opt-in flag, `list --json --include-removed`, as
explicitly-shaped ghost rows:
`{name, branch, path: null, git: null, runtime: {state: "absent"},
agent: {state: "none", reason: "no-worktree"}, session: {…, removed: {…}}}`.
Default output is byte-compatible with today; the ghost-row shape is a
contract addition clients opt into, not a change to existing fields
(cross-model review finding: the culled stratum is otherwise unservable
from `list`).

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
bin/workstreams focus  <name>                 # bring the live tab to front
bin/workstreams resume <name> [--agent claude|codex] [--fresh] [--at-final-sha]
bin/workstreams close  <name> [--force]
```

- **`focus`**: read `tty` from the registry; verify a live `claude`/`codex`
  process actually has that tty (`ps -o tty=` over the liveness snapshot —
  ttys are reused after tabs close, so the registry tty alone is not
  trusted); then AppleScript: select the Terminal.app tab whose `tty`
  matches, raise its window (`set index of window to 1`), `activate`. No
  live process on that tty → print "no live session — use resume" and exit
  1. The AppleScript lives in one adapter function
  (`bin/lib/terminal-tabs.sh`) so a future terminal swap touches one file.
  **Verified empirically 2026-08-09** from a live session: enumerating
  `tty of t`, `busy of t`, and `custom title of t` across all windows/tabs
  works, and `set selected of t to true` on a tab found by tty succeeds
  (window `id` is available for direct targeting). The remaining
  first-chunk verification is only `close` and the router-process TCC
  grant.
  **State model, stated plainly:** the system tracks *sessions* (registry
  tty + process liveness), never *tabs*. A tab whose agent exited but
  whose shell window stays open is invisible to `focus` (correctly — there
  is nothing to resume there) and is not cleaned up by anything here;
  stale empty tabs remain the human's to close, and `resume` on that
  worktree opens a fresh tab rather than reusing the dead one. Accepted:
  tracking tab existence would need a Terminal-side registry that drifts,
  and the cost of a leftover empty tab is one Cmd-W.
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
  3. Worktree culled (no dir; registry has `removed` with `merged: true`;
     `merged: false` gets a warning naming the final SHA and requires
     `--at-final-sha` or `--fresh` explicitly) → `bin/worktrees create
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
decision of what /workstreams/ shows.

**Why.** Today a merged worktree lingers only because a live tab pins it;
once `close` exists, culls become routine, and a cull without a record is a
dead end.

**Direction.** The /workstreams/ front page (Track D) lists three strata from
`list --json` + `session`:

1. **In progress** — unmerged, dirty, or live-agent worktrees. The main
   list. Buttons: focus (live) / resume (not live).
2. **Merged, session still open** — `merged && agent.state == live`. Flagged
   "close freely"; button: close.
3. **Recently culled** — ghost rows from `list --json --include-removed`
   whose `removed.merged` is `true`, newest first, capped at 15. Button:
   resume (which recreates). These do NOT appear in stratum 1 — a culled
   worktree has nothing unique, which is exactly why it was culled.
   Force-removed unmerged worktrees (`removed.merged: false`) are listed
   separately and dimmed, labeled with their final SHA and no
   reversibility implied — the branch is gone and the SHA is the only
   thread back.

Sweep eligibility changes in exactly one way: the Track G pin — a worktree
is cullable only if its box clone is (no unmerged stock content, no open
`manual-testing` issue naming the workstream). Otherwise the rules stay
locked per the control-surface plan; the other sweep additions are registry
pruning (Track A) and the finalSha capture inside `wt_remove_now`.

**First implementation chunk.** The `wt_remove_now` finalSha capture + a
doctest: remove a merged worktree, assert the registry gained
`removed.finalSha` equal to the pre-removal HEAD, then `create --base-ref
<that sha>` reproduces the tree.

### Track D — the /workstreams/ router app

**What.** The web surface: `/workstreams/` (front page), `/workstreams/issues/` (the moved
issues browser), `/workstreams/plans/` (Track E's view), and POST action endpoints
that run the Track B commands.

**Why.** "One page that shows what's outstanding" is the boxholder's stated
pain; the issues browser is main's-issues-regardless-of-prefix already —
its current `/main/dev/issues/` address is a lie about what it is (§7).

**Direction.**

- **Routing:** add `/workstreams` handling in `router.ts`'s requestListener ahead of
  `parseWorktreeName` (sibling of the `/__router/*` block,
  `bin/router.ts:916-1067`), delegating to a new `bin/router-workstreams.ts`
  (one-way import from router.ts, same discipline as `router-docs.ts`,
  `bin/CLAUDE.md:76-79`). Add matching cases in `classifyRouterRoute`
  (`bin/router-auth.ts:216-285`): GET/HEAD under `/workstreams` → `control-read`;
  POST `/workstreams/action/*` → `control`. Never serve /workstreams/ through the `/dev/`
  pipeline — it gets its own handler and its own CSP (`default-src 'none';
  style-src 'unsafe-inline'` to start; no scripts needed).
- **Rendering:** server-rendered HTML + `<form method="POST">` buttons,
  exactly the issues-browser + `/__router/stop` precedent. No client JS in
  v1 — this is what makes the CSP trivial and keeps the app one file.
  Auto-refresh via `<meta http-equiv="refresh" content="30">` on the front
  page (crude, sufficient, no-JS).
- **Front page data:** the router execas `bin/worktrees list --json
  --include-removed` (timeout 10s) rather than re-deriving state in
  TypeScript — the bash implementation is the single liveness authority
  (the control-surface plan settled this exact question in favor of bash
  for exactly this reason; a TS re-derivation would be the fail-open
  duplication again). Render the three strata from Track C. All links the
  page emits are **request-relative** (`/<name>/…`, `/workstreams/…`) — the
  `url` field in `list --json` is `http://localhost:<port>/…`
  (`bin/worktrees:211`) and is CLI display data only; rendered into a page
  viewed over Tailscale it would point at the viewer's own device
  (cross-model review finding).
- **Action endpoints:** `POST /workstreams/action/{focus|resume|close|recreate}/<name>`
  → execa `bin/workstreams <verb> <name>` with `<name>` validated by the same
  `[a-zA-Z0-9_-]+` rule as `wt_paths_valid_name` *before* building argv, no
  other request data reaching the command line. Response: 303 back to `/workstreams/`
  with a flash message (query param) reporting the command's first stderr
  line on failure. Security posture: these endpoints execute fixed local
  commands, so they are `control` (owner session + CSRF) **and** the plan
  accepts that a Tailscale-exposed router lets the owner's phone open a tab
  on the Mac — that is the feature, not a leak; a non-owner or cross-site
  request never reaches dispatch (`bin/router.ts:894-914` chokepoint). The
  spoof wall and `CB_HUB_SECRET` deletion already in place stay untouched.
  **Known residual (cross-model review): same-origin worktree frontends.**
  Worktree apps share the router's origin, so JS served by any branch's
  frontend passes the CSRF check and carries the owner cookie — a
  compromised or stale branch could POST `/workstreams/action/*`. The plan's
  posture is **accept and document**: every action is a fixed,
  name-validated verb whose worst case is opening/focusing a tab or a
  guarded `close` that refuses unmerged work — the verbs' own gates are
  the blast-radius bound, and all worktree frontend code is owner-authored.
  The escalation path if that trust assumption weakens (running
  third-party branches): move `/workstreams/` to its own port/origin, which the
  one-file `router-workstreams.ts` seam keeps cheap. This acceptance is a
  boxholder decision to confirm before implementation, recorded here so
  it is a choice, not a default.
- **Issues browser move:** mount `serveIssues` at `/workstreams/issues/` (it already
  takes `base` as a parameter, `bin/router-issues.ts` interface); change the
  router index link (`bin/router.ts:709`); 301 `/<name>/dev/issues/*` →
  `/workstreams/issues/*` (kept indefinitely — one line, and habit + docs point
  there). Grep tracked files for `dev/issues` links and update them.
- **osascript from the router:** the router process needs macOS Automation
  permission for Terminal.app the first time an action fires (TCC prompt on
  the Mac). This is a one-time grant; the first-chunk test exercises it
  deliberately so the prompt happens during implementation, not during real
  use. If denied, actions fail with the osascript error surfaced in the
  flash message — loud, not silent (§4).
- **Dev friction, stated plainly:** /workstreams/ lives in `bin/router*.ts`, so the
  implementing session tests against an isolated router
  (`CALLBACK_STATE_DIR` + `ROUTER_PORT`, `bin/CLAUDE.md:252`) and the live
  router picks the app up only after main-merge + boxholder-driven `pnpm dev`
  restart. The plan ships dark until that restart.

**First implementation chunk.** Route wiring + auth classification + a
read-only front page (three strata, no buttons), with a doctest against the
isolated router asserting: `/workstreams/` 200s for an owner session, 403s without,
and an unknown first segment still 404s as before (no regression in worktree
dispatch).

### Track E — plan/issue frontmatter and the plans view

**What.** The full, enforced frontmatter schemas for BOTH `docs/plans/*`
(and its two sibling dirs) and `issues/*`, a backfill of both corpora,
doc-check validation that rides the existing pre-commit hook, `/finish` +
cb-plan + issues-skill updates, and `/workstreams/plans/`.

**Why.** 44+ active plans, 0 machine-readable; the plan↔issue join exists in
3 of 44 files as prose; issue frontmatter is a convention no tool checks.
The /workstreams/ views need to answer "which plans are in flight and from which
branch" without an agent reading 19k lines, and worktree sessions must be
*forced* to record provenance at commit time, not asked to remember (§11,
§12 — enforcement over convention; the maintainer is an agent).

**Direction.**

- **The provenance field and its sentinels (vocabulary lock-in).**
  `workstream:` is **required** on every plan and every issue, holding the
  workstream's **bare short name** (`seam`, not `worktree-seam` — the
  branch encoding is substrate and does not leak into the schema). Required
  fields need an honest empty value or they attract garbage, so two
  sentinels are part of the enum (reserved: no workstream may be named
  `unattached` or `unknown`, enforced in `create`):
  - `workstream: <name>` — the workstream that carried (or is carrying)
    the work.
  - `workstream: unattached` — deliberately not workstream-born: filed
    from a main-checkout session, hand-written, or predating any specific
    work. This is the normal value for a fresh issue that merely *records*
    a tension.
  - `workstream: unknown` — provenance existed but is lost.
    **Backfill-only**: agents never write `unknown` for new items (they
    always know their own workstream — it's their branch name minus the
    prefix), and the validator could enforce that via the backfill commit
    being the only one that introduces it, but a lint can't see time — so
    the rule is documented in `issues/CLAUDE.md` and checked in review,
    while the schema itself accepts it anywhere (a later re-file of a
    lost-provenance item must stay expressible).
- **Plan frontmatter schema** (full):

  ```yaml
  ---
  title: "An agent-neutral worktree control surface"   # required
  status: active        # required: draft | active | partial | implemented | superseded | parked
  workstream: seam      # required: <name> | unattached | unknown
  issues:               # required list; [] allowed and means "no issue drove this"
    - ../../issues/features/2026-08-08-worktree-session-workflow-redesign.md
  superseded-by: other-plan.md   # only with status: superseded
  ---
  ```

  The prose `**Status:** …` first line is **replaced**, not duplicated — two
  status encodings would drift (§8). `docs/plans/README.md` is rewritten to
  document the frontmatter as the convention. Body H1 stays (unlike issues/)
  — plans are long documents read as documents.
- **Issue frontmatter schema** (full — formalizing `issues/CLAUDE.md`'s
  existing fields, which no tool validates today, plus the new field):

  ```yaml
  ---
  title: "Short human title"        # required (already universal)
  workstream: unattached            # required: <name> | unattached | unknown
  needs: [design]                   # optional: design | decision | manual-testing
  design: ../../callback-box/docs/plans/foo.md   # optional; must resolve
  area: callback-box                # optional string
  labels: [soft-launch]             # optional kebab-case list
  filed-by: agent                   # optional
  discovered-in: worktree-foo — while doing X    # optional free text
  resolution: implemented           # required under closed/, forbidden elsewhere:
                                    #   implemented | wontfix | superseded
  ---
  ```

  `discovered-in:` stays as prose color; `workstream:` is the queryable
  counterpart. `needs:` values and the `resolution:`/`closed/` consistency
  rule move from convention to validation.
- **Backfill:** one mechanical pass over both corpora, landing in the same
  commit as the validator so there is no bilingual window:
  - Plans (48 + implemented-plans/ + unimplemented-plans/): `status` derived
    from directory + existing prose line; `issues:` populated where an
    "Issues addressed" section already names them, else `[]`; `workstream:
    unknown` (except this plan and worktree-control-surface.md, whose
    workstreams are known).
  - Issues (~452): existing fields pass through untouched; `workstream:`
    added — `unknown` across the board, except items whose
    `discovered-in:` already names a `worktree-<name>` verbatim, which the
    backfill script promotes mechanically to the bare `<name>` (no
    guessing beyond exact pattern match).
- **Validation in doc-check — which IS the commit hook:** a new check in
  `callback-box/src/dev/doc-check.ts` using the `yaml` package + a
  fence-splitter patterned on `src/cards/frontmatter.ts:39` (NOT the
  router's hand-rolled parser — that one stays deliberately minimal for
  rendering). `doc-check` already runs in the root pre-commit chain on
  every commit (`.husky/` dispatch; it runs even on docs-only commits, per
  root CLAUDE.md "Commit docs WITH hooks"), so schema enforcement lands in
  the existing hook with zero new hook machinery — a session that files an
  issue without `workstream:` simply cannot commit it. Enforces, for
  plans: frontmatter present on every file under the three plan dirs, all
  required fields, `status` in the enum and consistent with the directory
  (implemented-plans/ ⇒ implemented; unimplemented-plans/ ⇒
  superseded|parked), `issues:` paths resolve, `superseded-by` only with
  the matching status. For issues: required `title` + `workstream` (enum:
  `[a-zA-Z0-9_-]+` | `unattached` | `unknown`, the sentinels reserved as
  names), `needs:` values in the enum, `resolution:` present-iff-closed,
  `design:` resolves. **Frontmatter paths are a
  new link class for doc-check, not a free rider**: today's `--fix` repairs
  only body markdown links via `repairLinks` (`doc-check.ts:161`) and has
  no frontmatter model at all (cross-model review finding), so E1
  explicitly includes feeding `issues:`/`superseded-by`/`design:` paths
  into the reference graph AND teaching `--fix` to rewrite them on moves —
  otherwise the validator would detect breakage `--fix` can't heal, which
  is worse than today. E3 carries the full consumer side of `workstream:`:
  `IssueFrontmatter` + `parseFrontmatter` projection in
  `bin/router-issues.ts` (which today discards unknown fields,
  `router-issues.ts:161`) and a workstream column in the issues view
  joined against live workstreams, since a validated field nobody renders
  answers nothing.
- **`/finish` integration — the concrete edits** (all in
  `.claude/agents/finish.md`; `.claude/skills/finish/SKILL.md` is a thin
  dispatcher and needs no change):
  - **Step 5b (scope verification):** the requirement list now starts from
    the plan's `issues:` frontmatter instead of hunting for an "Issues
    addressed" section (prose section as fallback during the habit tail).
    No other change — MET/PARTIAL/UNMET stays evidence-only.
  - **Step 6 (plan disposition):** each disposition writes `status:`
    frontmatter instead of the prose first line — `implemented` +
    `git mv` to implemented-plans/; `partial` (stays put, prose edited to
    mark real vs future); `superseded`/`parked` + `git mv` to
    unimplemented-plans/. The validator's directory-consistency rule is the
    enforcement backstop: a /finish that moves a plan without updating
    `status:` (or vice versa) fails its own pre-commit, so drift between
    the agent's habits and the schema is self-correcting rather than
    review-caught (§11). **After any plan `git mv`, run
    `pnpm --dir callback-box doc-check --fix`** — the moved plan's own
    relative `issues:`/`superseded-by:` paths and every inbound link
    re-resolve; today finish.md only prescribes this after *issue* moves
    (finish.md:423-425), and E1's frontmatter-path repair is what makes it
    work for the frontmatter class too.
  - **Step 6, `partial` case:** /finish **surfaces** the leftover work as a
    fully-drafted issue body (title, category, `workstream:` prefilled with
    its own workstream name) in its final report, and does NOT file it — the
    plan-lifecycle issue's open question, resolved toward "surface, don't
    perform": auto-filed fragments are how the queue fills with items
    nobody chose; agents arrange context, humans keep judgment.
  - **Step 7b (issue closing):** finds resolvable issues from the plan's
    `issues:` list first (prose fallback), then the existing
    commit-message/briefing/grep sweep unchanged. On close it already
    writes `resolution:`; it now also corrects `workstream:` when the
    resolving workstream differs from the filed value (an issue filed
    `unattached` and resolved by this workstream gets its name —
    provenance of the *fix*, which is what "pull up the workstream that
    did this" needs).
    The manual-testing guard (never close `needs: [manual-testing]`,
    finish.md:419-421) is untouched.
  - **New step — merge stock test content home** (spec in Track G):
    cherry-pick the box clone's `Test-Content: stock` commits onto the
    source test1; conflicts report BLOCKED-style, clone left intact.
  - **No registry interaction:** /finish merges and reports; the worktree's
    cull still happens through session-end/sweep, which is where the
    Track A removal record is written. /finish touching the registry would
    be a second writer for the same fact (§8).
  - cb-plan's template adds the frontmatter block; the "Issues addressed"
    prose section stays as the human-readable rendering of the same list.
- **`/workstreams/plans/`:** a read-only server-rendered list — status
  facets, workstream column joined against `list --json` (a plan whose
  workstream has a live worktree links to its front-page row), each plan
  linking to the existing `/main/dev/docs/` rendering of the file. Small:
  it is the issues browser's shape over a 50-file corpus.
- **Who stamps `workstream:`?** The filing session, at filing time — it
  always knows its own workstream (`git branch --show-current` minus the
  `worktree-` prefix), and writes `unattached` when the branch is `main`.
  cb-plan's template and the issues skill/`issues/CLAUDE.md` both gain the
  rule; the pre-commit validator is what makes forgetting impossible
  rather than discouraged. /finish additionally corrects `workstream:` on
  issues it closes when the resolving workstream differs from the filed
  one. Free-text `discovered-in:` stays for prose color; `workstream:` is
  the queryable field.

**First implementation chunk.** The doc-check validator + the full backfill
of both corpora (48+ plans, ~452 issues) in one commit (validator green over
the backfilled corpora is the test), touching no consumer yet.

### Track G — the manual-testing flow

**What.** Structure for the verification loop: a `## Manual testing` section
convention with a stable anchor, a testing queue view in `/workstreams/`,
and confirm/adjust actions — so "work through what's waiting on me" is one
page, not a grep plus tab archaeology.

**Why.** The flow exists today as `grep -rl manual-testing issues/` plus
reading whole issues plus remembering which tab held the work. Each step has
a home now: the queue is a facet, the instructions are prose *somewhere* in
the body, and "make adjustments" is the resume motion — but nothing connects
them. **This structures the existing queue; it adds no new producers of the
flag** — the [overuse decision](../../../issues/decisions/2026-07-29-manual-testing-flag-overuse.md)
stays open and untouched, and tightening its criteria would make this view
shorter, which is fine.

**Job to be done.** When I have a spare half hour for verification, I want
one page listing what's waiting on me, each item with its instructions one
click away and a button that reopens the workstream if something's wrong —
so confirming is cheap and finding-a-problem flows straight back into the
conversation that built the thing.

**Direction.**

- **The `## Manual testing` section convention.** An issue carrying
  `needs: [manual-testing]` MUST contain a `## Manual testing` section —
  what to try, what should happen (the substance `issues/CLAUDE.md` already
  demands in prose; now enforced by the E1 validator alongside the
  frontmatter rules, and addressable: the dev-docs renderer's heading
  anchors make it linkable as `<issue-url>#manual-testing`). The existing
  blockquote status callout stays as the at-a-glance line; the section is
  the procedure.
- **The queue view: `/workstreams/testing/`.** Server-rendered like
  everything else. Two sources, clearly separated:
  1. **Landed, awaiting verification** — main's issues with the flag (what
     the `needs:manual-testing` facet already finds). Each row: title, a
     direct link to `#manual-testing`, the `workstream:` name, and the
     **test target** — the deployed app or local main, per the item.
  2. **Pre-merge, testable in place** — issues touched by a live worktree
     (the existing overlay already computes this, `router-issues.ts:341-368`)
     whose worktree copy carries the flag. Test target: **the worktree's own
     URL** — `/<name>/<box>/…` is already served live by the router with
     lazy start; local pre-merge testing needs zero new deployment
     machinery, because the router is that machinery. Phone testing works
     too where the router is Tailscale-exposed.
  Buttons per row: **Open workstream** (the Track B resume action — this is
  the "found a problem, make adjustments" path, landing back in the
  conversation) and **Confirm**. Pre-merge rows get **no Confirm button** —
  the item isn't landed, so there is nothing to clear; verifying pre-merge
  work feeds back into the workstream (adjust, or just merge), and the flag
  is confirmed only once it exists on main.
- **Confirm.** POST `/workstreams/action/confirm-tested/<issue-basename>` →
  execa a new fixed CLI helper (`bin/workstreams confirm-tested <basename>`,
  main-checkout only): removes `manual-testing` from `needs:`, appends a
  one-line `> Verified by boxholder <date>` note under the `## Manual
  testing` header, moves the issue to `closed/<category>/` with
  `resolution: implemented` when nothing else in `needs:` remains (else it
  just clears the flag), runs `doc-check --fix`, and commits (issues/ is not
  a deployed path, so the post-commit deploy hook self-skips). The
  only-Ian-clears-it rule is preserved in substance: the button sits behind
  the owner-session gate, so the click *is* the boxholder clearing it;
  agents still may never run the helper (documented in `issues/CLAUDE.md`,
  same standing as the existing rule). Basename validated against the same
  no-traversal rule as workstream names before any path is built.
- **Issue detail pages** in `/workstreams/issues/` grow the same two buttons
  whenever the item carries the flag — the queue view is a filter, not the
  only door.
- **Reproductions: the worker stages the test, and marks its kind in the
  box commit.** A worktree's box is a test1 *clone*, so a manual test is
  only as good as what's in it. The convention (added to `issues/CLAUDE.md`
  and the worker-facing docs): before flagging `manual-testing`, the worker
  arranges the reproduction in their worktree's test1 clone and commits it
  with a **git trailer declaring its kind** — box commits already carry
  structured trailers (`Created-By:` etc., callback-box CLAUDE.md), so this
  rides the existing convention:
  - **`Test-Content: stock`** — supporting content the feature permanently
    needs; test1 itself should be augmented. These commits flow back to the
    source test1 at `/finish` (below).
  - **No trailer = throwaway.** Routine box churn (wakeups, agent
    processing) and staged-for-one-test scenarios are indistinguishable on
    purpose: both live and die with the clone. Only explicitly-marked stock
    content survives — the default is disposal, so forgetting the trailer
    can never leak scenario junk into the curated test1.
- **`/finish` merges stock content home.** A new /finish step (with the
  other finish.md edits in Track E): inspect the worktree's box clone for
  unmerged trailer-marked commits (`git log --grep 'Test-Content: stock'`
  over `origin/..HEAD` — the clone's `origin` already points at the source
  test1), and cherry-pick them onto the source box as part of landing.
  Interleaved routine commits are skipped by the trailer filter;
  cherry-pick conflicts don't guess — /finish reports BLOCKED-style and
  leaves the clone intact, same discipline as its merge conflicts. The
  payoff: once /finish lands, the reproduction for stock-supported features
  exists in **main's test1**, so post-merge testing targets `/main/test1/…`
  and needs nothing from the dead worktree.
- **Linking to reproductions — instructions stay one-click.** The
  `## Manual testing` section links the staged content by router URL, the
  same form everywhere: `/<workstream>/test1/browse/<card-path>` pre-merge,
  `/main/test1/browse/<card-path>` once stock content has landed (the
  user-facing card page is `/browse/`, not `/views/`). Workers get this as
  a documented pattern with an example in `issues/CLAUDE.md`, so
  instructions read "open this, do X, expect Y" with no prose directions
  into the box.
- **Cull pinning — a worktree is cullable only if its test1 is.** The
  general rule, replacing any special case: **sweep and session-end skip a
  worktree whose box clone is itself uncullable**, where uncullable means
  either (a) unmerged `Test-Content: stock` commits (the safety net when
  /finish hasn't run or was blocked — stock content must never die with a
  cull), or (b) the workstream is named (`workstream: <name>`) by an open
  main-side issue carrying `needs: [manual-testing]` (a throwaway repro
  someone still needs to exercise). Both checks are cheap at eligibility
  time (a trailer-filtered `git log` in the clone; a grep over issues/).
  Both release themselves: /finish merges stock home; `confirm-tested`
  clears the flag; the next sweep collects. The testing view and front page
  label held rows "worktree held for testing," so a pin is always visible,
  never a mystery lingerer. **Indefinite is acceptable** (boxholder
  decision): a pinned worktree with a throwaway repro simply exists until
  its test runs — no age-based auto-cull, because the pressure lives on the
  queue page where it belongs. This amends the control-surface plan's
  "eligibility rules unchanged" lock and the vocabulary bullet above;
  recorded as the one exception.
- **Every cull archives a diverged box; recreate restores from the
  branch.** One uniform rule (boxholder decision, superseding an earlier
  Release-only scoping): at cull time, if the box clone has diverged from
  its source (`git rev-list origin/main..HEAD` nonempty), its head is
  pushed to the **source test1 repo as a branch** —
  `archive/<workstream>-<date>` — before the clone is trashed; the
  registry records the ref in the `removed` record. A clone that hasn't
  diverged gets **no branch** — nothing to save, plain removal, and
  recreate just clones fresh. Recreate with an archive ref checks the box
  out at that branch, so box state survives the cull/recreate round trip
  for every workstream, not only pinned ones. Archive branches are
  lightweight storage: never merged to test1's main, cheap to keep, pruned
  only with the boxholder's approval during periodic maintenance. If the
  archive push fails, the cull refuses and the worktree stays — never
  trash the only copy on a failed save (§4). With archiving universal, the
  testing view's **Release** button is just "cull despite the pin"
  (owner-approved) — same mechanism, no special path.

**Pre-merge vs deployed testing — the decision.** Local-first: the worktree
URL covers "test my local trees" with no new machinery, and it is the only
target that exercises the code *before* merge. Testing on the deployed
server (cb-style prod) today means merging to main — acceptable for the
tail of items where prod-ness matters (real connectors, real data, HTTPS).
A **singular staging slot** ("test this" → deploy this branch to one
testing checkout, separate from main) is deliberately NOT designed here: it
touches deploy.sh, server provisioning, and prod auth — a different
subsystem with its own failure modes — and the boxholder's own lean is
local-first. Track F files it as an exploration issue so the idea is kept,
not built. What this plan guarantees is that when it IS built, the queue
view's test-target column is the one place it plugs in.

**First implementation chunk.** The `## Manual testing` section validation
in E1's validator (flag ⇒ section present) + the anchor link rendering —
convention before UI, so the corpus is clean before the view reads it.

### Track F — record what this plan decided elsewhere

- File `issues/exploration/2026-08-09-staging-slot-for-premerge-testing.md`:
  the "test this" singular staging deployment (one testing checkout on the
  server, deployable from any workstream, separate from main) — deliberately
  not designed in this plan (see Track G); the issue records the idea, the
  local-first lean, and that `/workstreams/testing/`'s test-target column is
  its integration point.
- File `issues/watch/2026-08-09-claude-worktree-isolation-off-switch.md`:
  trigger = upstream ships a disable flag
  (anthropics/claude-code#50109 or successor); when it fires, revisit
  whether `bin/land` and the /workstreams/-actions-run-in-the-router arrangement
  should simplify.
- Update the two addressed issues to point `design:` at this plan.
- Correct the redesign issue's "Gaps" section (the resume path and status
  join now have a design home).

## Could this be simpler?

**Simplest plausible version:** no /workstreams/ at all. Ship only Tracks A+B —
registry + `resume`/`focus`/`close` as CLI — and keep using
`/main/dev/issues/` where it is. That alone makes tabs disposable: close
freely, `bin/workstreams resume <name>` from any prompt.

What the fuller plan buys, concretely:

- **Track D (the app)** buys the *seeing* half of the boxholder's ask —
  "what worktrees are actually in progress" has no answer at a glance from a
  CLI you have to remember to run, and the phone/browser case (the buttons)
  doesn't exist at all without it. This is the JTBD itself, not polish.
- **The issues-browser move** buys truthful addressing (§7): the browser
  already ignores its worktree prefix; /workstreams/ is what it already is.
- **Track E** buys the join the views need — without frontmatter,
  `/workstreams/plans/` would be another prose-scraping renderer, extending the
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
dependency (`/workstreams/plans/` waiting on a subplan) with no open research
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
| `wt_remove_now` can't read HEAD before delete (corrupt worktree) | To add — remove with a broken .git | To add — record `removed` without `finalSha`; recreate then works from main only and says why | Clear: recreate prints "no final SHA recorded" |
| Pre-plan culls (no registry file at all) | Covered by absent-file doctest | Yes — stratum 3 simply doesn't list them; `resume` on them is the "unknown worktree" error | Clear |
| Router action execa times out / bin missing | To add — action doctest with a stubbed failing command | To add — 303 with flash carrying first stderr line; router never blocks on an action (10s timeout, killGroup) | Clear: flash message |
| osascript lacks Automation permission (TCC) | Exercised deliberately in chunk D2 on the real Mac | Error surfaces in flash / CLI stderr | Clear |
| `/workstreams` unknown-segment regression (auth misclassification) | To add — doctest: `/workstreams` owner-gated, `/workstreamsx` still 404s as worktree | Wiring in both dispatch and classifier per Track D | Clear |
| Recreated-from-main worktree is instantly sweep-eligible (ahead=0, clean) before its session launches | To add — recreate doctest races sweep | Handled by ordering — `resume` creates and launches in one flow; the launched agent pins it within seconds. Residual race accepted (sweep runs on session lifecycle events, not a timer) | Documented here; near-nil reachability on the real path |
| Plan frontmatter migration misses a file / wrong enum | Validator IS the test — doc-check red until corpus clean | Same commit, no bilingual window | Clear: doc-check names the file |
| `/finish` writes prose status out of habit (stale agent behavior) | doc-check catches the missing/duplicated status on its commit | finish.md edited in the same track | Clear: pre-commit fails |
| `confirm-tested` races a concurrent main-checkout commit (index.lock) | To add — helper doctest with a held lock | To add — the helper fails loudly (bounded retry, then error), never leaves a half-edited uncommitted issue; flash carries the stderr | Clear: flash message, file untouched or fully committed |
| `confirm-tested` targets an issue with no `## Manual testing` section (pre-validator legacy or hand-edit) | Covered — G1 validation makes this unrepresentable on new commits | Helper refuses and says why | Clear |
| Testing pin never releases (item flagged, never confirmed) | Not a code failure — a queue-pressure design | The held worktree is labeled on the very page listing what to test | Clear by construction: visible where you look |
| Worktree culled before its manual-testing flag lands on main (race: /finish merges, sweep fires, flag-bearing issue merges in the same push) | To add — G3 doctest ordering | The pin greps main's issues at eligibility time, and /finish's merge lands the issue and the code together, so the flag is on main before the session ends; residual race is a sweep firing mid-merge — accepted, recreate + re-stage per the section's instructions is the recovery | Clear: testing view shows a pre-merge row whose worktree is gone |
| /finish's stock cherry-pick onto source test1 conflicts | To add — finish doctest with a conflicting source commit | Yes by design — BLOCKED-style report, clone left intact, pin (a) keeps the worktree until resolved | Clear: /finish names the conflicting commit |
| Worker forgets the `Test-Content: stock` trailer | Not detectable — absence IS the throwaway default | The content dies with the clone; the manual test still ran against it pre-cull | Silent by design, and safe: the failure direction is losing test scaffolding, never leaking junk into curated test1 |

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
  /workstreams/ flash messages carry the command's stderr line.
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
- **Client-side JS in /workstreams/, live-updating status, WebSockets** — the no-JS
  server-rendered shape meets the JTBD; interactivity beyond POST forms is
  complexity with no named buyer yet.
- **Session *history* (resuming anything but the latest session)** — the
  claude picker (`claude --resume` bare) already serves the archaeology
  case; the registry records latest-only on purpose.
- **Codex resume-by-id** — unconfirmed upstream; `--last` from the worktree
  cwd is the recipe and suffices.
- **Auto-filing issues from partial plans** — /finish surfaces a proposed
  body; a human files (Track E, "arrange context, don't automate judgment").
- **New *producers* of `needs: [manual-testing]`** — the overuse decision
  is open; Track G structures the *existing* queue (section convention,
  view, confirm) without changing when or how often the flag gets applied.
- **A staging deployment slot** ("test this" → deploy a workstream to one
  testing checkout separate from main) — a different subsystem (deploy.sh,
  provisioning, prod auth); local-first via worktree URLs covers the bulk,
  and Track F files the exploration issue with its integration point named.
- **Box forking / pointing engines at real boxes** — blocked on the
  events.db bug; stays in the redesign issue.
- **Conductor or any packaged frontend** — the seam keeps them cheap to try;
  trying them is not this plan.
- **A `remove` button on /workstreams/** — destructive-beyond-close stays at the
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
- **Should `/workstreams/` get a link on the router index page's nav beyond
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

1. **A1 — registry lib + launcher writes** (`bin/lib/session-registry.sh`
   including the mkdir merge lock, both launcher paths, doctest for
   shape/locked-merge/absence).
2. **A2 — SessionStart registry hook** (worktree resolution shared with
   session-end.sh — extract the transcript-path parser into a lib function
   rather than copying it; hook wired into settings.json). Depends on A1.
3. **B0 — CLI rename** `bin/worktrees` → `bin/workstreams`: `git mv`, every
   caller and doc updated in the same commit (grep-driven: hooks, launcher,
   `codex-session-end`, `bin/CLAUDE.md`, root CLAUDE.md, skills), no alias
   left behind. Pure rename, zero behavior change; lands early so every
   later chunk writes the new name once. (Code citations elsewhere in this
   plan reference the pre-rename `bin/worktrees:<line>` — they describe
   today's tree and are correct as of writing.)
4. **B1 — launcher refactor** (`bin/lib/launch-session.sh` extraction; pure
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
9. **D1 — /workstreams/ wiring + read-only front page** (routes, auth classes, three
   strata, doctests incl. no-regression on worktree dispatch). Depends on C2.
10. **D2 — action endpoints** (POST forms, name validation, flash errors,
    TCC exercised). Depends on B3/B4, D1.
11. **D3 — issues browser move** (mount at /workstreams/issues/, 301s, link sweep).
    Depends on D1 only.
12. **E1 — frontmatter schemas: validator (plans + issues) +
    frontmatter-path repair in `--fix` + full backfill of both corpora**,
    one commit.
13. **E2 — /finish + cb-plan updates** (frontmatter writer, `issues:`
    reader, surface-don't-file for partials, `workstream:` stamping). Depends on
    E1.
14. **E3 — `/workstreams/plans/` view + issue `workstream:` projection**
    (`IssueFrontmatter` field, parser, branch column in the issues view).
    Depends on D1, E1.
15. **G1 — `## Manual testing` section validation** (flag ⇒ section, in
    E1's validator) + anchor rendering. Depends on E1.
16. **G2 — `/workstreams/testing/` view + `confirm-tested` helper + the
    two buttons on issue detail pages.** Depends on D1, G1; Open-workstream
    buttons depend on D2.
16b. **G2b — universal box archiving** in the cull path (divergence check;
    archive branch push to source test1 when diverged, none when clean;
    registry archive ref; recreate restores a box from its ref; refuse
    cull on failed push) + the Release button as pin-override. Depends on
    G2, G3, C1.
17. **G3 — box-cullability pin in sweep/session-end eligibility** (both
    checks: trailer-filtered `git log` in the clone + grep for an open
    `manual-testing` issue naming the workstream; doctests: pinned worktree
    survives sweep, released by stock-merge and by `confirm-tested`
    respectively) + the /finish stock cherry-pick step + the
    `Test-Content: stock` trailer and URL-linking conventions in
    `issues/CLAUDE.md` and the worker-facing docs. Depends on E1 (the
    `workstream:` field it greps), E2 (finish.md edits), G2 (confirm as a
    release).
18. **F — watch issue, staging exploration issue, `design:` links, redesign-issue gap corrections,
    `bin/CLAUDE.md` + `docs/plans/README.md` + `issues/CLAUDE.md` +
    `dev/README.md` docs (including the branch-sentinel rules and the
    "backfill-only `unknown`" convention).**

## Rollout shape

- **Test posture.** Named per chunk above; the done-when is those assertions
  passing plus one end-to-end rehearsal on the real machine: launch → close
  (tab gone) → front page shows culled → resume → conversation restored (or
  the B2-downgrade equivalent), performed once by the implementing session
  and once by the boxholder (this is the only intentionally-manual step —
  it exercises TCC and Terminal.app, which no doctest can).
- **Ships dark, lights on restart.** Everything lands on the worktree
  branch; `/finish` merges; the live router serves /workstreams/ only after the
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
