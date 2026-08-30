---
title: "Move the interactive workstreams surface into a resident application"
workstream: workstreams
area: router
labels: [router, architecture, workstreams]
resolution: implemented
filed-by: agent
discovered-by: Ian
discovered-in: workstreams — router architecture planning
design: ../../../beebox/docs/plans/workstreams-app.md
---

Implemented by the resident-app commit series from `43dd7891` through
`ef03d0f6`. The router now owns authentication, supervision, proxying, and the
buildless failure fallback; `workstreams-app/` owns the interactive application.
The boxholder-only shared-router and real-Terminal acceptance rehearsal remains
tracked in the partial plan rather than keeping this implementation issue open.

The workstreams, issues, plans, testing, quota, and lifecycle surfaces are now
an application implemented as HTML strings and hand-written browser JavaScript
inside the dependency-light dev router. This couples interactive product work
to the process that must remain available when installs and worktrees fail.

Build a resident app with the beebox technology patterns, but no shared
beebox source code. The router owns authentication, supervision, proxying,
failure fallback, and automatic app-only restart when landed app files change.
Keep the agent-facing `bin/workstreams` contract unchanged.

The full design is in the linked plan. This issue is deliberately narrower than
the broader router-architecture issue, which remains open for bootstrap routing,
middleware, validation, and logging work.
