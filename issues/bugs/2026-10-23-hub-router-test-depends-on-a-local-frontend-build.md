---
title: "server.router.test.ts fails in a checkout that has built the frontend"
workstream: unattached
area: beebox
labels: [tests]
filed-by: agent
discovered-in: worktree-perf-easy-wins — test:changed after a bundle analysis build
---

`test/hub/server.router.test.ts`, subtest "An unconfigured slug 404s without
touching any endpoint", expects the hub's own box list page at `/`. When
`src/frontend/dist/` exists, the hub serves the built frontend's `index.html`
there instead, and the check fails. With the directory moved away, all 40
checks pass (verified 2026-10-23).

`src/frontend/dist/` is a gitignored build artifact. `pnpm analyze:bundle`,
`pnpm build:frontend`, and the perf hub instructions all create it, so the
result of this test depends on what the checkout has built. The box server had
the same problem with the SPA fallback
([closed issue](../closed/bugs/2026-08-25-spa-fallback-doctests-fail-on-main.md)).
The fix there was to stop gating on the build artifact in the test harness;
the hub needs the same.
