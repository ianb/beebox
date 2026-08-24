---
title: "A newly launched workstream briefly looks safe for sweep to delete"
workstream: streams-and-issues
area: router
needs: [design]
labels: [workstreams, lifecycle, liveness]
filed-by: agent
discovered-by: agent
discovered-in: main clerical session — checking newly routed workstreams
priority: important
---

Immediately after a workstream is created, `bin/workstreams list` can report
`AGENT=none` for several seconds even though its Terminal launch is underway.
The agent process has not yet become observable by the shared process/cwd guard.

This matters because sweep treats `agent=none`, merged/clean, and unpinned as
eligible for removal. A freshly created branch is normally merged and clean, so
the gap can authorize cleanup before the session becomes visible.

The fix must not weaken or duplicate the fail-closed tri-state liveness guard.
A likely shape is a separate bounded launch-in-progress pin recorded before the
Terminal opens, cleared when the launched shell reaches the agent boundary, and
visible when it expires after a failed launch. The exact lease and recovery
semantics need design and a sweep eligibility test.

Related but distinct: [the concurrent creation race](2026-08-20-concurrent-workstream-launches-race.md).
