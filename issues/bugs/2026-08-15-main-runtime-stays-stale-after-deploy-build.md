---
title: "Main runtime stays stale after a deploy rebuild"
workstream: unattached
area: router
filed-by: agent
discovered-by: Ian
discovered-in: worktree-codex-engine-plan — verifying a fresh Codex chat after landing
---

The main checkout can rebuild `callback-box/dist/cli.mjs` without replacing an
already-running main hub generation or its `cb serve` children. The router sees
the generation as healthy and continues to route requests to processes that
loaded the previous build.

This caused a fresh Codex chat to use pre-fix model-selection code after the fix
had merged and the deploy hook had produced a new build. The observed process
timeline was:

- The main hub and box child started before the merge.
- The merge hook rebuilt `dist/` successfully.
- The shared router remained alive and continued to reuse the old hub and child.
- `bin/workstreams down main` followed by an authenticated request started a new
  generation, which loaded the current build.

The deploy or router lifecycle needs an explicit invalidation contract for main
backend changes. Possible locations include the post-merge deploy hook, a build
generation marker checked by the router, or source/build watching in the hub
supervisor. The right mechanism must preserve the invariant that worktree
processes and the shared router are not restarted unnecessarily.
