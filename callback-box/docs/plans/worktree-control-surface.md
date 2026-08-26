---
title: "An agent-neutral worktree control surface"
status: partial
workstream: worktree-control-surface
issues: []
---
# An agent-neutral worktree control surface

The repo's worktree logic works, but it lives behind a Claude Code hook
interface. Any other frontend must impersonate Claude Code to use it. This plan
moves that logic into `bin/workstreams` as ordinary CLI subcommands and makes every
frontend — Claude Code, Codex, a router web page, a third-party tool — a thin
client of the same command. Behavior does not change. Who can call it does.

**Issues addressed:**

- [worktree/session workflow redesign](../../../issues/closed/features/2026-08-08-worktree-session-workflow-redesign.md)
  — this plan is that issue's *enabling refactor*, and does not close it. It
  makes the pieces recombinable; the workflow change stays there.

- [derive public worktree paths](../../../issues/closed/code-quality/2026-08-01-derive-public-worktree-paths.md)
  — the hardcoded `~/src/…` paths live in exactly the files this plan rewrites.
  Deriving them is folded into Track A, not left as a separate sweep.
- [dev scripts into bin](../../../issues/docs-and-chores/2026-05-26-dev-scripts-into-bin.md)
  — `bin/` is the brand for first-class dev tools. This plan applies that
  principle to the single largest piece of dev tooling still outside `bin/`.
- [sweep's live-agent guard fails open](../../../issues/closed/bugs/2026-08-04-sweep-live-agent-guard-fails-open.md)
  — the fix that issue sketches ("fold sweep onto `wt_other_agent_live`") is the
  same convergence Track B performs. The plan carries it.

**Related, deliberately NOT addressed:**
[manual-testing flag overuse](../../../issues/decisions/2026-07-29-manual-testing-flag-overuse.md)
is open and unresolved. Nothing in this plan may assume more `manual-testing`
items exist or design a flow that produces them. See NOT in scope.

**On the "issue about making the system":** no such item existed when this plan
was written — I grepped every open category directory for `worktree` (109 files
hit) and read every candidate title. The boxholder filed
[the redesign issue](../../../issues/closed/features/2026-08-08-worktree-session-workflow-redesign.md)
later the same day, and it agrees with this plan on the substance: the two-case
distinction, the rejection of Conductor and the desktop app as unbuildable-upon,
the Codex-must-stay-first-class constraint, and the three-way status
recomputation. It carries scope this plan does not: the issue↔worktree data link,
box forking, and the `/workstreams/issues/` extension.

## What this plan builds now

The boxholder's framing (2026-08-08): *"the idea is not to change the current
workflow, but to simplify the pieces so that I can make workflow changes more
easily."*

That draws the line precisely, and it moves one track:

- **Tracks A, B, C are built.** They move code and unify computation. Every
  existing motion — `claude --worktree`, `bin/launch-worktree-session`, `sweep`,
  the hooks — behaves as it does today, with two deliberate exceptions recorded
  under "Behavior drift accepted" below.
- **Track D (`resume`) is designed here but NOT built.** A new motion is a
  workflow change, which is the thing being deferred, not enabled-then-deferred.
  Its design stays in this document because it is the load-bearing test of
  whether the seam is shaped right: a `resume` that could not be written
  agent-neutrally would mean Track C's contract is wrong.
- **The session hint file (chunk 8) is dropped** for the same reason. It only
  existed to serve `resume`.

So the deliverable is: the same workflow, over pieces that can be recombined.

### Behavior drift accepted

Two changes a user or caller could notice. Both were chosen, and a cross-model
review flagged both as drift that "no workflow change" would otherwise deny.

- **`bin/workstreams list` no longer aliases `status`.** On `main` they were the
  same router-status JSON. `list` is now the unified worktree table and `status`
  is the raw router JSON. Accepted after grepping every tracked file for both
  commands: only `status` had callers (`bin/CLAUDE.md`, the `browse` skill), and
  `list` as a router-status alias was referenced nowhere. Reusing the better name
  for the better view beats keeping a dead alias.
- **`bin/launch-worktree-session` no longer falls back to `$HOME/src/callback-box`.**
  Concrete case that used to work and now fails: the launcher *copied* (not
  symlinked) into `~/.local/bin`, where self-location finds no checkout. It now
  refuses instead of launching a session against a checkout it merely guessed.
  That is the fail-closed rule the derive-paths issue asks for, applied
  consistently; the script already resolves symlinks, so the supported install
  shape is unaffected.

## The problem this exists to solve

The boxholder runs many parallel worktree sessions and keeps each one open until
he has verified its work. An open session is currently the only durable record of
"this still needs checking."

That has three costs. A live session pins its worktree — `bin/workstreams sweep`
skips any worktree with a live agent process (`bin/workstreams:172`, `:189`), so a
merged, clean worktree lingers only because a tab is open on it. There is no
place to look for "what is outstanding" other than the tab bar. And switching is
heavy, because switching means finding the right tab rather than naming the right
worktree.

The boxholder evaluated the complete tools — Conductor (conductor.build) and the
Claude Code desktop app — and rejected both for one reason this plan must
preserve: **they are monoliths he cannot build tools on top of.** Conductor could
technically run the creation script, but it would own the layer he has customized
most.

**Hard constraint: Codex is a first-class frontend and stays one.** Nothing in
this design may be Claude-Code-only.

## Stated preferences this plan trades against

- `callback-box/docs/engineering-principles.md` §7 *Hierarchy is a
  discoverability contract* — where a thing lives is a claim about what it is.
  Repo-wide worktree logic living in `.claude/hooks/` claims it belongs to Claude
  Code. It does not.
- `callback-box/docs/engineering-principles.md` §8 *One way to do each thing* —
  today there are two entry paths into worktree creation (a hook Claude Code
  fires, and a launcher that synthesizes hook JSON), both reaching the same
  script through the same JSON-on-stdin protocol. One command with two thin
  callers is the single way.
- `callback-box/docs/engineering-principles.md` §4 *Resilient AND never silent*
  and §6 *Right-sized defensiveness* — every destructive path here stands in
  front of an irreversible delete. `bin/lib/worktree-teardown.sh:16-18`: *"every
  'can't tell' answer resolves to 'don't delete'."*
- `bin/CLAUDE.md` — the incident-hardened invariants for router lifecycle, the
  `ps -axo pid=,comm=` rule, the private-issues symlink topology, and the
  "before changing worktree lifecycle code, read `bin/docs/router-protocol.md`"
  gate.
- The `derive-public-worktree-paths` issue's own stated precedent:
  `bin/private-issues` derives every location from an explicit checkout argument
  via `git rev-parse --git-common-dir`, with no `$HOME` assumption.

## What already exists

The substrate is largely built. Every claim below is verified against the tree at
`worktree-seam`.

**Creation logic — 291 lines, already agent-neutral in substance.**
`.claude/hooks/worktree-create.sh` overrides the worktree location
(`:66` `worktree_path="$HOME/src/callback-worktrees/$NAME"`) because callback-box
has a `file:../personal-vibe-check` dependency that only resolves when the
worktree is a sibling of the monorepo (`:5-10`). It clones the test box
(`:130-217`), copies connector secrets, fetches annex content, applies the v2
`pnpm.overrides` link (`:203-211`), copies `callback-box/.env` minus `BOXES=`
(`:236-242`), runs the workspace install (`:252`), generates the Codex AGENTS.md
mirrors (`:94-102`, `:256`), writes `settings.local.json` (`:264-270`), and
re-runs `cb init` against the clone (`:277-286`). None of that is Claude-specific.
**Reuse verbatim** — Track A moves it, it does not rewrite it.

**The interface is the only Claude-specific part.**
`.claude/hooks/worktree-create.sh:51-53` reads its arguments as hook JSON on
stdin: `requested_path=$(printf '%s' "$input" | jq -r '.worktree_path //
.worktreePath // .path // empty')`. Stdout is reserved for the resulting path
(`:39` `exec 3>&1 1>&2`, `:291`).

**Codex already impersonates Claude Code to reach it.**
`bin/launch-worktree-session:189`: `wt_path=$(printf '{"name":"%s"}' "$wt" |
.claude/hooks/worktree-create.sh)`. The comment at `:15-16` states the reason
plainly: *"Codex has no --worktree, so this path invokes the WorktreeCreate hook
directly."* This is the concrete evidence that the shape, not the substance, is
wrong.

**Both hooks are wired.** `.claude/settings.json:18,24` (`WorktreeCreate` →
`.claude/hooks/worktree-create.sh`) and `:29,35` (`WorktreeRemove` →
`.claude/hooks/worktree-remove.sh`).

**Creation is already idempotent and already has a resume branch.**
`.claude/hooks/worktree-create.sh:106-112`: an existing registration re-mounts
private-issues, regenerates the AGENTS.md mirrors, prints the path, and exits.
Track D's `resume` builds on this, it does not duplicate it.

**Teardown has one shared implementation — except for sweep.**
`bin/lib/worktree-teardown.sh` owns `wt_other_agent_live`, `wt_work_state`,
`wt_remove_now`, `wt_log`, sourced by `.claude/hooks/session-end.sh` and
`bin/codex-session-end`. Its liveness guard is tri-state (`:65-67`: *"the answer
is in WT_AGENT_STATE (`none` | `live` | `unknown`)… Callers MUST treat `unknown`
the same as `live`"*). `bin/workstreams` sweep keeps its own two-state copy
(`:145`, `:155-160`) and `bin/lib/worktree-teardown.sh:11-14` says why: *"it
takes ONE system-wide process snapshot and reuses it across N worktrees, and
removes with `git worktree remove --force` rather than the trash-mv below."*
**Reconcile, don't rebuild** — Track B passes a snapshot into the shared guard.

**Merged worktrees already auto-delete.** `bin/workstreams:193-231` removes any
worktree that is `ahead=0`, non-deletion-clean, and has no live agent. The
lingering the boxholder experiences is caused by the liveness guard doing its
job, not by missing cleanup.

**`bin/workstreams` has no `create`, `remove`, `list --json`, or `resume`.** The
dispatch at `bin/workstreams:32` covers `serve`, `status | list`, `down`, `panic`,
`sweep`, `help`. `status | list` (`:37-46`) is a `curl … | jq .` passthrough of
the router's `/__router/status`.

**The router already reports per-worktree runtime state, including cold ones.**
`bin/router.ts:916-940` discovers worktrees from disk first *"so cold worktrees
(not yet hit by a request) still appear"*, emitting `{ state: "cold" }` or
`{ state: "ready", frontendPort, backendPort, vitePid, fastifyPid, … }`.
**Reuse** — Track C joins onto this rather than re-deriving runtime state.

**Three signals recompute independently and none persist.** Git ahead/dirty is
computed in sweep's bash (`bin/workstreams:193-198`). Running/idle lives in the
router's in-memory map and is lost on restart (`bin/router.ts:916-940` re-derives
it). Session liveness is computed by `ps`/`lsof` in two places
(`bin/lib/worktree-teardown.sh` and `bin/workstreams:145-161`). Joining them is
Track C, and it is the enabling step for any dashboard.

**A faceted issues browser already exists and already overlays worktrees.**
`bin/router-issues.ts:673` derives the `needs` facet (so `needs:manual-testing`
is already filterable), and `:559` `worktreeBadges` marks which active worktree
has touched each issue. **Reuse as the first web client** — Track E, sketch only.

**Terminal-tab spawning already exists.** `bin/launch-worktree-session:255-260`
opens a tab with `osascript` / `do script`. That is the precedent for a web
button that opens a real terminal.

**`--name` is cosmetic.** `bin/launch-worktree-session:164` passes
`--name "$wt"` to `claude` purely so concurrent tabs stay tellable apart
(`:50-51`). Nothing in the repo reads it back, and there is no session registry
of any kind.

## Prior art (external)

- **Claude Code's `WorktreeCreate` hook is documented as a full replacement for
  `git worktree add`, with stdin JSON in and an absolute path on stdout** —
  [Run parallel sessions with worktrees, Claude Code docs](https://code.claude.com/docs/en/worktrees);
  a worked example of relocating worktrees outside `.claude/worktrees/` is
  [Creating worktrees with Claude Code in a custom directory](https://www.sabatino.dev/creating-worktrees-with-claude-code-in-a-custom-directory/).
  Confirms the adapter in Track A is a supported shape, not a workaround: the
  hook may shell out to anything as long as it prints a path.
- **The setup-in-a-worktree problem is common enough to have a shared solution
  and an open upstream request.**
  [tfriedel/claude-worktree-hooks](https://github.com/tfriedel/claude-worktree-hooks)
  packages env-file copying, dependency install, and deterministic port
  assignment as hooks; upstream
  [anthropics/claude-code#27744](https://github.com/anthropics/claude-code/issues/27744)
  asks for a dedicated post-create setup hook. Both bind the setup logic to
  Claude Code, which is exactly the coupling this plan inverts. No prior art
  found for the inverse arrangement (repo CLI owns creation, frontends adapt).
- **Multi-agent worktree orchestrators are all frameworks, not primitives.**
  Claude Squad, Vibe Kanban, Agentree, and `@johnlindquist/worktree` each own the
  session lifecycle and expect to be the outer layer
  ([Best Git Worktree Tools for AI Coding in 2026](https://nimbalyst.com/blog/best-git-worktree-tools-ai-coding-2026/),
  [awesome-agent-orchestrators](https://github.com/andyrewlee/awesome-agent-orchestrators)).
  Vibe Kanban is explicitly agent-agnostic, which is the one property worth
  copying; its vendor announced shutdown in early 2026 and it now survives as a
  community project, which is itself the argument for a seam rather than a bet.
- **No prior art found for a documented CLI contract that several agent
  frontends adapt into.** Searched for a session-registry or `list --json`
  contract shared across agents; the tools found keep their session state
  private to the tool. Track C's JSON shape has no external precedent to copy,
  so it is designed here.

## Tracks / scope

Ordered by implementation dependency, then surface size.

### Track A — `bin/workstreams create <name>`

**What.** Move the 291 lines of `.claude/hooks/worktree-create.sh` into
`bin/workstreams` (or `bin/lib/worktree-create.sh`, sourced by it) behind a plain
CLI interface. The hook shrinks to an adapter that parses hook JSON and calls the
command.

**Why this needs to change.** The logic is repo-wide but its address says
Claude Code, and its calling convention is a hook protocol. `bin/launch-worktree-session:189`
already pays that tax by synthesizing `{"name":"…"}`. Any third frontend pays it
again. Principle §7: the location is a false claim about ownership.

**Direction.**

```
bin/workstreams create <name> [--base-ref <ref>] [--path <dir>] [--quiet]
```

Prints the absolute worktree path on stdout; all logging to stderr (preserving
`.claude/hooks/worktree-create.sh:39`'s stream discipline, which the adapter
depends on). Exit non-zero aborts. Idempotent: an existing registration takes the
resume branch at `:106-112`.

The hook becomes:

```sh
#!/usr/bin/env bash
set -euo pipefail
input=$(cat)
name=$(printf '%s' "$input" | jq -r '.name // .worktree_name // empty')
path=$(printf '%s' "$input" | jq -r '.worktree_path // .worktreePath // .path // empty')
[ -n "$name" ] || name=$(basename "$path")
base=$(printf '%s' "$input" | jq -r '.base_ref // .baseRef // "main"')
exec "$(git rev-parse --show-toplevel)/bin/workstreams" create "$name" --base-ref "$base"
```

`bin/launch-worktree-session`'s codex path drops the JSON synthesis and calls
`bin/workstreams create "$wt"` directly.

**Path derivation folds in here.** The three hardcoded roots
(`.claude/hooks/worktree-create.sh:66-68`) become one derivation helper in
`bin/lib/`, following the `bin/private-issues` pattern the issue cites:
`git rev-parse --path-format=absolute --git-common-dir` from an explicit checkout
argument gives the main checkout; the worktree root and box root are named peers
of it. `bin/workstreams:134-135` and the hooks' own copies consume the same helper.
Overridable by env for the isolated-router test path, matching
`CALLBACK_STATE_DIR`.

**First implementation chunk.** Add `bin/lib/worktree-paths.sh` with the
derivation helper and switch `bin/workstreams sweep` (`:134-135`) to it. No new
commands, no moved logic — the smallest change that proves the derivation is
correct against a live tree, and it lands with zero callers depending on it yet.

### Track B — `bin/workstreams remove <name>`

**What.** A `remove` subcommand that is the one destructive path, and the
convergence of sweep's guard onto `wt_other_agent_live`.

**Why this needs to change.** Three removal paths exist:
`.claude/hooks/worktree-remove.sh` (95 lines), `wt_remove_now` in
`bin/lib/worktree-teardown.sh`, and sweep's inline block
(`bin/workstreams:205-231`). Only two share an implementation. Sweep's liveness
guard is two-state where the shared one is tri-state, and
[the filed bug](../../../issues/closed/bugs/2026-08-04-sweep-live-agent-guard-fails-open.md)
records the consequence: a failed `ps`/`lsof` reads as "nothing running" and the
delete proceeds. Principle §4 — this is the exact "resilient to the impossible"
inversion, a guard that fails open in front of an irreversible action.

**Direction.**

```
bin/workstreams remove <name> [--keep-branch] [--force] [--dry-run]
```

Refuses by default when the worktree is unmerged, dirty, or has a live agent, and
prints which of those blocked it. `--force` skips the merged/dirty checks; it
**never** skips the liveness check — that one is not overridable, since a live
agent is the case where the delete destroys work in flight.

`wt_other_agent_live` gains an optional pre-captured process snapshot so sweep can
keep its one-snapshot-for-N-worktrees property while using the tri-state answer.
That is the reconciliation the shared lib's own comment
(`bin/lib/worktree-teardown.sh:11-14`) says is missing.

Sweep becomes a loop over `remove --dry-run`-style eligibility plus `remove`.
`.claude/hooks/worktree-remove.sh` shrinks to an adapter like Track A's.

**Vocabulary lock-in.** `remove` means the destructive path everywhere: hook,
sweep, teardown lib, and CLI. `down` stays what it is today — stop the router
processes only (`bin/workstreams:48-55`) — and the help text must say so, because
"down" and "remove" are otherwise easy to confuse at a prompt.

**First implementation chunk.** Add the snapshot parameter to
`wt_other_agent_live` and switch sweep onto it, deleting sweep's inline
`ps`/`lsof` (`bin/workstreams:145-161`). This closes the filed bug on its own and
lands before any command moves.

### Track C — `bin/workstreams list --json`

**What.** One command that joins the three signals that today recompute
independently and never persist: git state, router runtime state, and agent
liveness.

**Why this needs to change.** "What is outstanding?" has no answer today except
the tab bar. Each signal exists; none is queryable together. Every client this
plan imagines — a web page, a resume command, a status line, the boxholder at a
prompt — needs the join, and if it does not exist each client re-derives it, in
its own language, with its own subtly different liveness guard. That is how the
fail-open bug happened once already.

**Direction.** `bin/workstreams list` prints a human table; `--json` prints an
array. Proposed record shape — this is the contract other clients bind to, so it
is a lock-in:

```jsonc
{
  "name": "seam",
  "branch": "worktree-seam",
  "path": "/…/callback-worktrees/seam",
  "git": { "ahead": 3, "behind": 0, "dirty": 2, "merged": false },
  "runtime": { "state": "cold" },          // cold | ready | stopped; ports when ready
  "agent": { "state": "live", "kind": "claude", "reason": "argv" },
  //          none | live | unknown        — unknown is never collapsed into none
  "box": "/…/box-worktrees/seam/test1",
  "url": "http://localhost:3210/seam/"
}
```

Three properties are load-bearing. `agent.state` carries all three values, so a
client cannot accidentally re-introduce the fail-open collapse. `runtime` mirrors
`bin/router.ts:916-940` exactly, including `cold`, rather than inventing a second
vocabulary. And `list` answers with no router running — git and agent state come
from disk and `ps`; `runtime` degrades to `{"state":"unknown"}`.

**Deliberately stateless.** `list` derives everything at call time. It writes no
registry and reads no cache, so it cannot drift from reality. The one thing it
genuinely cannot derive — which agent to resume with — is Track D's problem, and
Track D is where new persisted state gets justified.

**First implementation chunk.** `list --json` with `git` and `agent` populated
and `runtime` hardcoded to `unknown`, plus a doctest asserting the shape.
Complete and useful on its own — that alone answers "what is outstanding."

### Track D — `bin/workstreams resume <name> [--agent claude|codex]` (DEFERRED, not built)

**What.** Reopen a session in an existing worktree, with the right agent, in a
new Terminal tab. The genuinely missing motion — and therefore a workflow change,
which is why it is designed here and deferred. The design is retained as the test
of Track C's contract: if `resume` cannot be written agent-neutrally over
`list --json`, the contract is wrong.

**Why this needs to change.** There is no resume today. Reopening means
remembering which agent ran there and retyping the launch by hand.
`--resume` is Claude-only; `codex resume` is a different command with a different
session store. A resume built on Claude's flag would violate the hard constraint
in its first line, so this must be agent-aware by construction.

**Direction.** `resume` reuses `bin/launch-worktree-session`'s tab-spawning
(`:255-260`) and its per-agent launch scripts (`:151-238`), targeting an existing
worktree instead of creating one. Creation is already idempotent
(`.claude/hooks/worktree-create.sh:106-112`), so `resume` calls
`bin/workstreams create` first and gets self-healing (private-issues re-mount,
AGENTS.md regeneration) for free.

`--agent` is required unless the worktree records which agent last ran there.
Recording it is the one piece of new persisted state this plan adds:
`$STATE_DIR/sessions/<name>.json`, written at launch by
`bin/launch-worktree-session` and by `create`, holding `{ agent, model,
remoteControl, launchedAt }`. It is a hint, not a source of truth — if the file is
missing, `resume` asks for `--agent` rather than guessing, and `list --json`
surfaces it as `agent.lastKind` distinct from live-process detection.

**Resuming the conversation, not just the directory, is an open question** — see
Open design questions. The first version resumes the *worktree* with a fresh
agent context, which is the motion that is missing today.

**First implementation chunk.** `resume <name> --agent <kind>` with `--agent`
mandatory and no session file at all. Fully useful, adds no state, and defers
every question about what to persist to a later chunk in the same plan.

### Track E — thin clients (sketch; NOT in scope)

Named so the seam's purpose is legible, not to be built here.

`/workstreams/issues/` becomes a client over `list --json`, replacing the overlay's own
worktree discovery (`bin/router-issues.ts:334-360`). A web button that opens a
terminal tab has its precedent in `bin/launch-worktree-session`'s `osascript`
(`:255-260`). **Web for seeing, Terminal for doing, no multiplexer** — the
boxholder dislikes tty switchers, and nothing in this plan introduces one.

## The optionality argument

The seam's value is not that it makes any one client better. It is that trying a
client stops being a bet.

Today, trying Conductor means adopting it: it would own worktree creation, the
layer most customized here. With `bin/workstreams create` as the contract, trying
Conductor costs one creation script that shells out to the command, and
abandoning it costs deleting that script. The same holds for the desktop app, a
future frontend, or a hand-rolled web page. This is the direct answer to "I can't
put tools on top of it."

| Frontend | How it creates a worktree |
|---|---|
| Claude Code | `WorktreeCreate` hook adapter → `bin/workstreams create` |
| Codex | `bin/launch-worktree-session` → `bin/workstreams create` |
| A router web page | button → `bin/workstreams create` |
| Conductor, if ever tried | its creation script → `bin/workstreams create` |

## Sessions should be disposable — the two cases differ

The deeper goal is that a follow-up outlives its worktree, so a session can be
closed without losing the record. The two cases that keep a session open are not
the same, and conflating them is what makes "resume" ambiguous:

- **Merged, needs verification.** The code is on `main`. The worktree holds
  nothing unique and `sweep` would already collect it (`bin/workstreams:193-231`).
  What is needed is a *record of what to check* — which is what `issues/` is for.
  No resume is involved.
- **Unmerged, paused mid-work.** The worktree is the only copy of the work.
  Resume is real, and it is Track D.

This plan builds the second. It does not build the first, because the first is
entangled with the open `manual-testing` decision (see NOT in scope).

## Could this be simpler?

**The simplest version that could plausibly work:** add `bin/workstreams list
--json` and change nothing else. Leave creation in the hook, leave Codex
synthesizing JSON, leave the three removal paths. That single command answers
"what is outstanding," which is the boxholder's stated pain.

**What the fuller plan buys, concretely:**

- Track A buys the frontend seam. The simple version leaves `bin/launch-worktree-session:189`
  as the only way a non-Claude frontend reaches creation, so a third frontend
  must impersonate Claude Code a second time. Traces to §8, one way to do each
  thing.
- Track A also buys the path-derivation fix. `derive-public-worktree-paths` names
  four files; three of them are the files Track A rewrites. Doing it separately
  means editing incident-hardened lifecycle code twice. Traces to
  *consolidate over blast-radius fear* — combining is cheaper than sequencing
  here, not riskier.
- Track B buys the fail-open fix, which is a filed bug with a concrete trigger: a
  live codex session in a merged, clean worktree during an `lsof` failure gets its
  worktree deleted. Traces to §4, resilient and never silent.
- Track D buys the motion that lets a session be closed at all. Without it, "keep
  the tab open" remains the only way back into a paused worktree, so the original
  pain survives the plan.

**What is genuinely at risk of over-building:** the session registry in Track D.
It is the only new persisted state in the plan, and persisted state that mirrors
reality is exactly what `list` was designed to avoid. It is scoped down to a
hint that `resume` may ignore, and Track D's first chunk ships without it. If it
does not earn itself, delete it — nothing else depends on it. Traces to
*stop over-engineering rare failures*.

## Subplans

None. Every open question in this plan is either inside a later chunk (not the
first), or is a scoping question that Open design questions records with a lean.
No sub-question needs its own research-and-decide phase.

## Failure modes

No critical gaps. Each row below has either handling or a test named in Rollout
shape.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `create` is called with a name that already has a worktree registered | To add — doctest: create twice, assert same path, assert no second clone | Yes — `.claude/hooks/worktree-create.sh:106-112` resume branch, moved verbatim | Clear: logs "resume, skipping setup" |
| The hook adapter can't find `bin/workstreams` (worktree predates the refactor, or a detached checkout) | To add — adapter unit test with a bogus toplevel | To add — adapter must fail loudly; a silent fallback to the old inline logic would let two implementations coexist | Must be clear: worktree creation aborts with the resolved path it tried |
| Path derivation resolves a *different* root than the hardcoded one on the boxholder's machine (e.g. checkout is at `~/src/callback-box` but `--git-common-dir` resolves through a symlink) | To add — assert derived roots equal today's hardcoded values on this machine | To add — a one-time assertion in the derivation helper, not a silent fallback | Clear: refuse and print both paths. Silently picking either is how a worktree gets created outside every lifecycle hook |
| `remove` runs while an agent is live and `ps`/`lsof` fail | To add — inject a failing `ps` and assert refusal | Partly — `wt_other_agent_live` returns `unknown` (`bin/lib/worktree-teardown.sh:65-67`); sweep currently ignores it (`bin/workstreams:145,155-160`) | Today: **silent** — this is the filed bug. After Track B: clear, skip with printed reason |
| `remove --force` is used on a worktree with a live agent | To add | To add — `--force` must not override the liveness check | Clear: refuse, and say `--force` does not apply to liveness |
| `list --json` runs with no router | To add — doctest asserting `runtime.state == "unknown"` | To add — degrade, never fail the whole command | Clear: per-field `unknown`, not an omitted field |
| `list --json` runs while a worktree is being removed (directory half-gone) | Built + exercised | Built — the row's `git.ahead`/`dirty`/`merged` are `null`, never `0`, and the rest of the list is unaffected. (Shipped as nulls rather than the `git.state: "unreadable"` field this plan first proposed: `wt_work_state` already answers `"?"` for "could not tell", and a null carries that through JSON without a second vocabulary for the same fact.) | Clear: one bad row, rest of the list intact |
| A client parses `agent.state` and treats `unknown` as `none` | Not testable in this repo — it is a contract risk for future clients | Mitigation: the field is a three-value enum with no boolean shorthand, and `bin/CLAUDE.md` documents the rule | Clear only if documented — Rollout shape requires the doc line |
| `resume` targets a worktree that was swept away | To add | Yes by construction — `create` is idempotent and recreates it, on the same branch if the branch survives (`.claude/hooks/worktree-create.sh:113-115`) | Clear: logs "attaching without -b" |
| The session file names an agent that is not installed | To add | To add — `resume` verifies the binary before opening a tab | Clear: fail before the tab, not inside it |
| The session file is stale (agent changed since) | No test — it is a hint by design | Yes — `resume --agent` overrides, and the file is never the sole source of truth | Clear: `--agent` wins, silently and correctly |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — n/a. This plan adds no card schema, tag, or
  agent-authored field. The nearest analog is an agent choosing `remove` when it
  meant `down`; **ADDRESSED** by the vocabulary lock-in in Track B and the help
  text requirement in Rollout shape.
- **Stale ref** — **ADDRESSED**. The analog is `resume` naming a worktree that no
  longer exists; `create`'s idempotence recreates it
  (`.claude/hooks/worktree-create.sh:106-118`).
- **Two agents touching the same card** — **ADDRESSED** for the case that
  matters: two agents acting on the same worktree. `wt_other_agent_live` with the
  `--exclude-self-ancestor` discipline (`bin/lib/worktree-teardown.sh:76-83`) is
  the existing guard, and Track B extends it to sweep rather than adding a second
  one. Concurrent `create` for the same name is **GAP** — see Open design
  questions.
- **Hand-edit drift** — **ADDRESSED**. A hand-made worktree (created with plain
  `git worktree add`, never through `create`) has no session file and possibly a
  non-conforming name. `list` reports it from disk; `resume` demands `--agent`;
  sweep's argv signal already misses names outside `[a-zA-Z0-9_-]+`
  (`bin/workstreams:145`, noted in the filed bug) and Track B's convergence onto
  cwd-based detection covers it.
- **Fabricated free-form value** — **ADDRESSED by design**. `list` derives every
  field from git, `ps`, and the router. There is no free-form field for an agent
  to invent. The session file's `agent`/`model` are written by the launcher from
  its own arguments, never by a model.
- **Validation error UX** — **ADDRESSED**. Every refusal prints which check
  blocked it and the path it resolved, because these commands are read by agents
  as often as by the boxholder (§12, the maintainer is usually an agent). "Cannot
  remove" with no reason would send an agent looking for a workaround.
- **Partial migration / transition state** — **ADDRESSED**. During the rollout
  window, worktrees created by the old inline hook and by the new command are
  identical on disk, because Track A moves the code without changing it. The one
  asymmetry is an *existing* worktree whose `.claude/hooks/worktree-create.sh` is
  the old inline copy: `claude --worktree` runs the **main checkout's** hook, so
  the adapter is picked up as soon as the change lands on `main`. Worktrees
  branched before the merge keep a stale copy in their tree, which is only read
  if something invokes it by path — `bin/launch-worktree-session:189` does exactly
  that, from `$MONO`, which is main. So: no bilingual period.

## NOT in scope

- **Anything that assumes more `needs: [manual-testing]` items.** The flag is
  under review as over-applied
  ([2026-07-29-manual-testing-flag-overuse](../../../issues/decisions/2026-07-29-manual-testing-flag-overuse.md)),
  and the boxholder has said he does not want that much manual testing. A
  "verification queue" feature would prejudge that decision.
- **A dashboard, a web UI, or any Track E client.** The seam is the deliverable;
  clients are cheap once it exists, and building one now would encode the current
  guesses about what the boxholder wants to see.
- **A multiplexer, tmux integration, or in-terminal session switcher.** The
  boxholder dislikes tty switchers. Terminal tabs stay the unit.
- **Resuming a *conversation*** (Claude `--resume` with a session id, `codex
  resume`). Track D resumes the worktree. See Open design questions.
- **Trying Conductor.** The plan makes it cheap to try; it does not try it.
- **Changing what `sweep` decides.** Track B changes how sweep *computes*
  liveness (tri-state) and what code it shares. The eligibility rule —
  merged, clean, no live agent — is unchanged.
- **The `bin/browse` / `pnpm exec` audit** that
  [dev-scripts-into-bin](../../../issues/docs-and-chores/2026-05-26-dev-scripts-into-bin.md)
  also asks for. This plan applies that issue's principle to worktree tooling
  only; the broader audit stays open.

## Open design questions

- **Should `resume` reattach the actual conversation?** Claude has `--resume
  <session-id>`; Codex has `codex resume`. Both need a session id the launcher
  never sees today — Claude Code could write one from a `SessionStart` hook,
  Codex stores its own under `~/.codex/sessions`. **Leaned no for the first
  version; answered yes on 2026-08-26**, once daily use produced the case this
  was waiting for (a culled `chat-scroll` came back with its 1MB transcript on
  disk and no way to reach it). Claude's id comes from the `SessionStart` hook
  as anticipated; Codex keeps its own `codex resume --last` path and gains
  nothing here. The per-agent id story stayed per-agent, so the Claude-only
  coupling this plan removes did not come back.
- **Does the session file earn itself?** Stated in Track D's first chunk as
  deliberately absent. Decide after using `resume --agent` by hand for a while.
  **Lean: probably yes for `--agent`, probably no for `model`** — retyping a
  model name is trivial, and a stale recorded model is worse than no record.
- **Concurrent `create` for the same name.** Two launches racing on `git worktree
  add` is a known failure (batched launches have produced invalid-cwd sessions).
  Today the mitigation is "launch one at a time." A lock in `create` would fix it
  properly, but the failure is rare and the mitigation is known. **Lean: add a
  `mkdir`-based lock, matching `pi_lock` in `bin/private-issues`** — the pattern
  already exists, so the cost is small. Not in the first chunk.
- ~~**Does `list --json` belong in bash or TypeScript?**~~ **Settled during
  implementation: bash.** The lean was TypeScript on ergonomic grounds, but the
  agent-liveness answer has to come from `wt_other_agent_live` and a TS
  implementation would have meant a second copy of the exact guard whose
  duplication caused the fail-open bug this plan closes. `jq` does the JSON
  assembly, which was the only real argument for TS. Traces to §8, one way to do
  each thing — and it outranks ergonomics for a safety-critical guard.

## Knowledge audits

**Skip, with rationale.** Knowledge audits
(`callback-box/src/dev/knowledge-audits.yaml`) test what a *box* agent knows from
box CLAUDE.md, the generated agent guide, and schema instructions. Everything in
this plan is dev-repo tooling, which is invisible to box agents — an audit cannot
test it, and writing one would produce a test that passes or fails for reasons
unrelated to the change.

The agent-facing surface this plan does create — `bin/workstreams` subcommands and
the `list --json` contract — is documented for agents in `bin/CLAUDE.md`, and the
enforcement is the tri-state enum itself rather than recall (§11, enforcement
beats convention).

## Implementation order

Each chunk is a commit or a few related commits. All land before the plan ships.

1. **Path derivation helper** (`bin/lib/worktree-paths.sh`), consumed by
   `bin/workstreams sweep` only. The planned refuse-on-mismatch assertion (derived
   roots must equal the old hardcoded ones) was **not** shipped as runtime code:
   it is a one-time migration check, not a durable invariant, and it was verified
   by hand instead — all five derived locations matched exactly. What `wt_paths_init`
   does refuse at runtime is a checkout with no `callback-box/`, and an override
   that would aim a destructive root at the source box or the main checkout.
2. **Tri-state liveness in sweep** — snapshot parameter on
   `wt_other_agent_live`, sweep's inline `ps`/`lsof` deleted. Closes
   [the fail-open bug](../../../issues/closed/bugs/2026-08-04-sweep-live-agent-guard-fails-open.md).
   Depends on nothing; can swap order with 1.
3. **`bin/workstreams create`** — logic moved verbatim from the hook, hook reduced
   to an adapter, `bin/launch-worktree-session` codex path switched off the JSON
   synthesis, hardcoded roots switched to chunk 1's helper. Depends on 1.
4. **`bin/workstreams remove`** — the destructive path unified; sweep and
   `.claude/hooks/worktree-remove.sh` become callers. Depends on 2 and 3.
5. **`bin/workstreams list --json`** — git and agent fields, `runtime: unknown`.
   Depends on 1 and 2.
6. **`list --json` router join** — `runtime` populated from
   `/__router/status` over the UDS, degrading to `unknown` when the router is
   down. Depends on 5.
7. ~~**`bin/workstreams resume`**~~ — deferred, see "What this plan builds now."
8. ~~**Session hint file**~~ — dropped with chunk 7; it existed only to serve it.
9. **Docs** — `bin/CLAUDE.md` gains the command contract and the `agent.state`
   tri-state rule; root `CLAUDE.md`'s worktree paragraph points at it.

## Rollout shape

**Test posture.** Every chunk names its test before it is written:

- Chunk 1 — assert the derived roots equal today's literal values on this
  machine, and that an unresolvable checkout refuses rather than falling back.
- Chunk 2 — inject a failing `ps` and a failing `lsof` and assert sweep skips the
  worktree with a printed reason. This is the regression anchor for the filed
  bug, and it is the reason chunk 2 is early: it makes every later destructive
  change testable.
- Chunk 3 — create twice, assert the same path and no second box clone; assert
  the hook adapter and a direct CLI call produce identical results; assert a
  missing `bin/workstreams` aborts loudly.
- Chunk 4 — assert refusal on unmerged, on dirty, on live-agent, and that
  `--force` overrides the first two but not the third.
- Chunks 5-6 — doctest the JSON shape, including `runtime.state == "unknown"`
  with no router and null (never `0`) git counts for a half-removed directory.
- Chunk 7 — assert `resume` refuses a missing agent binary before opening a tab.

The done-when for the plan is those assertions passing, not "the commands feel
right."

**Migration.** No data-shape change. The only migration is chunk 8's session
file, which is created-on-write with no back-fill: absent means "ask for
`--agent`," which is the correct behavior for every pre-existing worktree
forever. Nothing needs to be migrated at all.

**Cross-model review.** This plan defines a contract every session depends on, so
`/cross-model` runs before it is called done, per the root CLAUDE.md rule.
