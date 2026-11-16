---
title: "cross-box-probe: the box-install node_modules mode check fails locally"
workstream: main-green
area: beebox
labels: [tests, deploy]
filed-by: agent
discovered-by: agent
discovered-in: worktree-self-hosted-turn
resolution: implemented
---

**Closed (implemented, 2026-11-15):** Cause: since 0820e6640 the helper builds each box's engine shim from the engine's package.json, and the test's stub engine had none, so the helper skipped the box with an ERROR before running pnpm (exit 0, stderr piped away). The helper is right; the test stub engine now has a package.json.

`beebox/test/scenarios/cross-box-probe.test.ts`, "a deploy's box install
leaves node_modules without other-access", fails with `ENOENT` on
`boxes/fresh/box/node_modules`. The test stubs `pnpm` with a script that runs
`mkdir -p node_modules/.pnpm`, runs `deploy/server-bin/bbx-box-install`, and
expects that directory to exist. It fails the same way on `main` (1548362b6)
on macOS, so it predates the branch where it was seen. Not investigated
further: whether the helper skips the stubbed `pnpm` on macOS or runs it in
another directory.

## Note 2026-11-15

Still fails on main at `ccae6c351`. This is the same failure as [the 2026-11-14 report](2026-11-14-cross-box-probe-install-test-fails-on-main.md); the two issues are one defect. The hourly full-suite run also reports it red on main. That run is on this Mac too, so whether it fails on Linux is still unchecked.
