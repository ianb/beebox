---
title: "Router: a superseded start's self-clean can stop the replacement generation's agent-browser dashboard (name-scoped socket dir)"
area: bin/router
filed-by: agent
discovered-in: router-state-formalization Phase A (codex review, finding #1)
resolution: wontfix
---

> **Closed 2026-08-06 — wontfix (negligible impact).** The only consequence is a
> dev-only agent-browser dashboard daemon getting killed and auto-restarting on
> next use — no worktree/data impact — and the boxholder doesn't use the dashboard.
> Not worth the generation-scoping fix. The proper fix is recorded below
> (generation-scoped dashboard socket dir / a generation token the `dashboard stop`
> checks) if the impact ever changes.

The agent-browser dashboard is keyed by worktree NAME, not generation:
`browseDirsFor(name)` returns the same `socket`/`profile` dir for every
generation of a worktree, and `dashboard stop` acts on whatever daemon owns
that socket dir. So only one dashboard daemon per name exists at a time,
shared across overlapping generations.

Phase A's invariant-#5 self-clean (a superseded start killing its own
children before resolving) runs `dashboard stop` with the name-scoped
`browseEnv`. If generation A is superseded by B and B has already reached its
own `dashboard start` (which first stops A's daemon, then starts B's on the
shared socket dir), A's self-clean `dashboard stop` then kills **B's** live
dashboard.

This is a pre-existing hazard class — the `waitForHttp`-failure path has always
stopped the name-scoped dashboard the same way — that Phase A widens by adding a
second self-clean site. It's narrow (requires stop-during-start plus a quick B
start that reaches dashboard-start within A's completion window, seconds) and
low-severity (the dashboard is a dev-only agent-browser convenience; a killed
daemon just restarts on next use — no worktree/data impact). It was left
unfixed in Phase A deliberately.

Proper fix: make the dashboard generation-scoped (per-generation socket dir, or
a generation token the `dashboard stop` checks) so a stale generation can only
ever stop its OWN daemon — the same identity discipline invariants #4/#5 apply
to vite/fastify. Alternatively, skip the dashboard-stop entirely on the
superseded self-clean path (accept a possible brief daemon leak that the next
`dashboard start` reclaims anyway) since a superseded generation by definition
no longer owns the name.
