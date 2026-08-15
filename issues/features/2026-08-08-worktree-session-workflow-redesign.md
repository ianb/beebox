---
title: "Worktree/session workflow: make follow-ups outlive their worktrees"
workstream: unknown
area: monorepo
design: ../../callback-box/docs/implemented-plans/workstreams.md
labels: [worktrees, sessions, workflow]
---

> **Core workflow implemented.** The durable registry, disposable sessions,
> resume/focus/recreate flow, joined status, resident workstreams app, and
> manual-testing queue are live. The remaining scope recorded in this issue is
> real-box attachment or forking. It has separate safety blockers and was not
> part of the implemented session/worktree workflow.

Sessions are currently doing double duty as a to-do database. A worktree stays
open until Ian has verified the work, because the open session is the only
record of _what still needs checking_. Everything else follows from that:

- Closing a session feels lossy, so ~9 accumulate (they were live when this was
  filed, on a machine that had exhausted its 20 GB of swap).
- There's no way to see what's outstanding — the list exists only as terminal tabs.
- Merged worktrees linger. **The cleanup already exists** — `bin/workstreams sweep`
  plus `.claude/hooks/session-end.sh` remove any worktree that is `ahead=0`,
  clean, and has no live agent. They linger _because a live session pins them_:
  the sweep deliberately skips a worktree with a running `claude`/`codex`
  process. Fix the record-keeping and the router list cleans itself with no new
  code.

## The distinction the design turns on

"Keep it open until verified" is two cases with opposite answers:

- **Merged + needs verification** — the code is on `main`; the worktree has
  nothing unique about it. Nothing to resume; you only need a record of what to
  check. The worktree should go away.
- **Unmerged, paused mid-work** — the worktree is the only copy. Resume is real.

Today both pin a tab. Separating them is what makes the first case disposable.

## What already exists

- `needs: [manual-testing]` (see [issues/CLAUDE.md](../CLAUDE.md)) is the
  existing record for "landed, awaiting human verification" — 10 open items
  carry it. Only Ian may clear it; agents must never remove it.
- `bin/router-issues.ts` already serves a faceted `/workstreams/issues/` browser with
  `needs:manual-testing` as a filter facet, overlaid with what each active
  worktree has changed. Much of the "master view" is built.
- `bin/launch-worktree-session` spawns real Terminal.app tabs via `osascript` —
  the precedent for a web button that opens a terminal.

## Gaps

- **The issue↔worktree link is prose, not data.** `discovered-in:` is free text
  (`worktree-foo — while building bar`). The implemented `workstream:` field now
  makes the durable association queryable; `discovered-in:` remains provenance.
- **Resume and unified status are implemented.** The session registry,
  `bin/workstreams resume`, joined `list --json` state, and the
  `/workstreams/` control surface now live in the
  [workstreams plan](../../callback-box/docs/implemented-plans/workstreams.md). Remaining
  territory in this issue is the real-box/forking work described below, not the
  terminal-tab lifecycle.

## The enabling refactor is landing (2026-08-08, `worktree-seam`)

[The agent-neutral worktree control surface](../../callback-box/docs/plans/worktree-control-surface.md)
is the plan for the pieces this redesign needs, deliberately scoped to change
**no** workflow — only to make the pieces recombinable. What it removes from the
gap list above:

- Worktree creation and removal are now `bin/workstreams create` /
  `bin/workstreams remove`. Claude Code's hooks and `bin/launch-worktree-session`
  are thin clients of the same command, so a new frontend (a web button, a
  packaged tool) no longer has to impersonate Claude Code to reach the repo's own
  worktree logic. That is what makes trying Conductor cost one script instead of a
  bet.
- The three-way liveness recomputation is collapsing onto one shared, tri-state
  guard — `unknown` no longer reads as "nothing running", which was a fail-open
  hole in front of an irreversible delete.
- `bin/workstreams list --json` is the planned join of the three signals, and the
  thing `/workstreams/issues/` would consume instead of re-deriving worktree state.

That enabling refactor is now consumed by the implemented workstreams design;
the current workflow and status live in the
[workstreams plan](../../callback-box/docs/implemented-plans/workstreams.md).

## Direction (not settled)

Extend `/workstreams/issues/` rather than build a dashboard — it has the facets, the
worktree overlay, and the rendering path already. Web for seeing, Terminal for
doing; Ian dislikes tty switchers, which rules out ccmanager/Claude Squad.

Packaged tools were evaluated and rejected: Conductor (conductor.build) and
Claude Code's desktop app are monoliths that own the layer we've customized most
and can't be built on top of. **Codex must stay first-class**, so nothing may be
Claude-Code-only. The enabling refactor has its own plan —
[the agent-neutral worktree control surface](../../callback-box/docs/plans/worktree-control-surface.md),
summarized above.

## Open dependencies

- [manual-testing flag overuse](../decisions/2026-07-29-manual-testing-flag-overuse.md)
  is unresolved — Ian has said the flag is over-applied. Don't design a flow that
  assumes _more_ manual-testing items until that's settled; tightening the
  criteria may shrink this problem more than tooling would.
- Box forking is part of this redesign and unfiled here: Ian wants to point new
  engine code at his real working boxes rather than a clone, when no migration is
  needed. Pointing an engine at an arbitrary box already works (`BOXES=` in a
  worktree's `.env`, or `cb serve <path>`). Two things block doing it safely —
  module-resolution split-brain (box-local schemas resolve `callback-box` through
  the box's own `node_modules` symlink, so a worktree's `cb serve` can load a
  _second_ engine build in-process), and the `events.db` truncation hazard filed
  as [two engines on one box truncate each other's events](../bugs/2026-08-08-events-db-truncates-across-engine-checkouts.md).
