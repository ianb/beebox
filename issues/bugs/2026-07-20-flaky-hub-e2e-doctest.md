---
title: "hub-e2e doctest times out under parallel suite runs"
area: callback-box
filed-by: agent
discovered-in: main — scheduled agent-SDK update (0.3.210 → 0.3.214)
---

`test/hub/hub-e2e.doctest.md` failed twice in a row in full `pnpm -C callback-box test`
runs, both times as `waitFor: timed out` at `test/hub/hub-e2e.doctest.md:51` (the
30s poll wrapper), with the whole file taking ~31s. In isolation
(`pnpm exec tap run test/hub/hub-e2e.doctest.md`) it passes 8/8 in ~5s.

What makes it more than routine flake noise: both failures came immediately after
a heavy `pnpm install` (the SDK bump churned ~400 packages), and two subsequent
full runs on the *same* bumped tree were green 4462/4462 — as was a control run
on the pre-bump tree. So the trigger looks like machine load / cold page cache
during the run, not the SDK version and not a defect in hub startup. Same family
as [flaky-mobile-spa-fallback-doctest](2026-07-10-flaky-mobile-spa-fallback-doctest.md)
and the `.taprc` `jobs: 6` thundering-herd hazard noted there.

The tension is whether the fix is a bigger `timeoutMs` for this particular
`waitFor` (the file builds `dist/cli.mjs` and boots a hub plus a box child before
polling, so 30s is not a generous budget on a loaded machine), or whether the
suite-wide contention hazard deserves a real fix rather than another per-test
bump. Next occurrence: capture the hub/child stdio from the parallel run to
confirm it's slow-start rather than a wedged child.
