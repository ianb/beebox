---
title: "A WebSocket upgrade touches worktree activity — can a reconnecting stale tab keep a worktree alive?"
workstream: unattached
area: router
labels: [router, worktrees]
filed-by: agent
discovered-by: agent
discovered-in: tour-health — cross-model review of the router split (pre-existing at the old bin/router.ts:1421)
---

`bin/router-upgrade.ts` calls `core.touch(handle)` on every accepted WebSocket
upgrade. The router contract (root `CLAUDE.md`, `bin/CLAUDE.md`) says only HTTP
requests count as activity and WebSockets never *wake* a worktree; an upgrade
of an already-running worktree is an HTTP request, so a single touch is within
the letter of it. The question is the loop: a stale tab whose socket drops
reconnects on a timer, each reconnect is an upgrade, each upgrade touches — so
a forgotten tab could hold a worktree past its 5-minute idle stop
indefinitely. "Stale tabs self-heal" in the contract may or may not cover it.

Worth one measurement (leave a tab open, kill its socket, watch
`/__router/status` `startedAt`/idle) before deciding whether the touch should
move to "only when the upgrade carried a fresh page load".
