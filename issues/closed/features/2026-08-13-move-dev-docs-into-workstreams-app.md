---
title: "Move the worktree docs browser into the workstreams application"
workstream: dev-docs-workflow
area: router
labels: [router, workstreams, documents]
priority: important
filed-by: agent
discovered-by: Ian
discovered-in: workstreams — resident application planning
---

The first resident workstreams application should leave `/dev/docs/` in the
router so app extraction does not also absorb Markdoc rendering, path
containment, ignored-file discovery, and URL migration.

Later, move the docs index and document reader into the workstreams application
so a workstream's plans, issues, and documents can share one navigation model.
Preserve direct disk reads and the invariant that browsing docs never starts the
selected worktree. Keep raw and scripted `dev/*.html` artifacts and
`dev/tools.json` in the router.
