---
title: "A newly launched workstream briefly looks safe for sweep to delete"
workstream: streams-and-issues
design: ../../../callback-box/docs/implemented-plans/workstream-launch-liveness.md
area: router
labels: [workstreams, lifecycle, liveness]
filed-by: agent
discovered-by: agent
discovered-in: main clerical session — checking newly routed workstreams
priority: important
resolution: implemented
---

Immediately after a workstream is created, `bin/workstreams list` could report
`AGENT=none` for several seconds even though its Terminal launch was underway.
The agent process had not yet become observable by the shared process/cwd guard.

This mattered because sweep treated `agent=none`, merged/clean, and unpinned as
eligible for removal. A freshly created branch is normally merged and clean, so
the gap could authorize cleanup before the session became visible.

## Resolution

Launch now establishes a token-owned, 60-minute registry lease before Terminal
automation begins. The shared liveness guard reports active leases as
`launching` only after process evidence finds no live agent, so sweep, removal,
SessionEnd, and process cleanup fail closed through setup without masking a real
process. Setup and Terminal failures become inspectable terminal states;
failed/expired registry-only rows can retry and age out after retention.

Claude clears the lease at its agent boundary. Codex retains it while its child
runs and clears it before teardown, avoiding a child-process visibility gap.
Doctests cover token supersession, expiry, setup and automation failure,
process precedence, routing, list projection, retry/refusal behavior, resident
UI controls, and process cleanup.

Related but distinct: [the concurrent creation race](2026-08-20-concurrent-workstream-launches-race.md).
