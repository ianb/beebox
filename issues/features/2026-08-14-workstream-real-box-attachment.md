---
title: "Let a workstream safely attach to a real box"
workstream: unattached
area: monorepo
needs: [design]
labels: [worktrees, boxes, developer-experience]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-workstreams — designing disposable workstream sessions
priority: backlog
---

When I need to test new engine code against the shape and behavior of a working
box, I want to attach that box to one workstream explicitly, so I can test the
real integration without copying its full state or silently running two engines
against it.

Pointing an engine at an arbitrary box already works through `BOXES=` or
`bbx serve <path>`. That mechanism is too easy to use unsafely as a workstream
feature. The workstreams application should not expose it until the engine can
detect and refuse unsafe concurrent ownership.

Two known blockers define the initial design boundary:

- [Two engine checkouts can truncate each other's events database](../bugs/2026-08-08-events-db-truncates-across-engine-checkouts.md).
- Box-local schemas can resolve `beebox` through the box package's own
  `node_modules` link while the serving command comes from a worktree. That can
  load two engine builds into one process.

The design must distinguish attachment from cloning. Attachment uses an
existing box in place and therefore needs explicit ownership, visible status,
and refusal when another engine is active. Cloning produces disposable test
data and remains the default workstream behavior.

Do not include operations on a particular developer's live boxes in the public
design or tests. Use synthetic package-layout fixtures until a separate,
explicitly authorized real-box check is needed.
