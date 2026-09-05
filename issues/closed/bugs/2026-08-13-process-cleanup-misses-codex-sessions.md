---
title: "Router startup cleanup does not recognize live Codex sessions"
workstream: codex-cleanup-guard
area: router
labels: [router, agents, lifecycle]
filed-by: agent
discovered-by: agent
discovered-in: workstreams — isolated resident-app router rehearsal
priority: important
resolution: implemented
---

Closed by the fix on `worktree-codex-cleanup-guard`. `bin/process-cleanup.ts` no
longer decides liveness itself: `bin/workstreams agent-liveness <path>...`
exposes `wt_other_agent_live`'s tri-state answer as JSON, and the sweep consumes
it. `unknown` — including "the oracle would not run" — spares every daemon in
that worktree, which is stricter than the tri-state rule requires, because
reaping a superseded orphan otherwise rests on the socket dir's pidfiles alone.
Covered by `beebox/test/dev/process-cleanup-liveness.doctest.md`.

The sibling hole in the same matcher —
[a hand-launched Chrome for Testing is unreapable](../../bugs/2026-08-14-hand-launched-chrome-for-testing-unreapable.md)
— stays open, deliberately. The two point in opposite directions: this one
reclaimed a resource it should have spared, that one spares a resource it should
reclaim. Landing them together would mean shipping a widened kill matcher in the
same change as a widened spare rule, where a mistake in either is destructive
and neither is separately bisectable. That issue also needs a design step this
one did not (a hand-launched browser sits under `~/.agent-browser/browsers/`,
outside every project-scoped path this module is allowed to touch, so ownership
has to be established by process tree or profile dir first).

An isolated router startup ran `process-cleanup.ts` and reclaimed an
`agent-browser` process belonging to this live Codex worktree. The cleanup guard
recognizes live Claude sessions but does not recognize Codex sessions, so it can
mistake a Codex-owned browser daemon for an orphan.

Extend live-session ownership detection to Codex without weakening orphan
cleanup. Reproduce with an isolated router and a Codex-owned browser process;
do not test by restarting the shared router.
