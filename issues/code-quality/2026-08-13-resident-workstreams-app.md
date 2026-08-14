---
title: "Move the interactive workstreams surface into a resident application"
workstream: workstreams
area: router
needs: [design]
labels: [router, architecture, workstreams]
filed-by: agent
discovered-by: Ian
discovered-in: workstreams — router architecture planning
design: ../../callback-box/docs/plans/workstreams-app.md
---

The workstreams, issues, plans, testing, quota, and lifecycle surfaces are now
an application implemented as HTML strings and hand-written browser JavaScript
inside the dependency-light dev router. This couples interactive product work
to the process that must remain available when installs and worktrees fail.

Build a resident app with the callback-box technology patterns, but no shared
callback-box source code. The router owns authentication, supervision, proxying,
failure fallback, and automatic app-only restart when landed app files change.
Keep the agent-facing `bin/workstreams` contract unchanged.

The full design is in the linked plan. This issue is deliberately narrower than
the broader router-architecture issue, which remains open for bootstrap routing,
middleware, validation, and logging work.
