---
title: "cross-box-probe: the box-install permission test fails on main"
workstream: unattached
area: beebox
labels: [tests, deploy]
filed-by: agent
discovered-by: agent
discovered-in: worktree-activity-triggers — the change-selected suite, 2026-11-14
---

`test/scenarios/cross-box-probe.test.ts`, "a deploy's box install leaves
node_modules without other-access", fails with

```
ENOENT: no such file or directory, stat '…/bbx-probe-install-…/boxes/fresh/box/node_modules'
```

It fails the same way on `main` (run from `~/src/beebox/beebox` on
2026-11-14), so it is not caused by the activity-triggers change that
selected it. The test stubs `pnpm` with a script that runs
`mkdir -p node_modules/.pnpm` and then expects `node_modules` under the box;
either the helper `deploy/server-bin/bbx-box-install` no longer runs the
stub where the test looks, or the stub's working directory moved.
