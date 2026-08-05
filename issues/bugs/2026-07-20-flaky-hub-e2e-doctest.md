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

## Another occurrence, with a different symptom (2026-07-30, worktree `chat-photo-batch-upload`)

Two parallel-run failures during the chat-photo-batch-upload work, both green on
an immediate serial or repeat run — so the same contention family, but the
symptom is worth recording because it is **not** a timeout:

- `pnpm exec tap test/core/bulk-upload/*.doctest.md test/webapp/routes/bulk-upload-routes.doctest.md`
  → `{ total: 10, pass: 6, fail: 4 }`, and the failing files reported
  **`1..0 # no tests found`** with `exitCode: 1`. With `-j1`: 64/64 pass.
- Full `pnpm test` → `{ total: 5231, pass: 5224, fail: 7 }`; immediate re-run
  `{ total: 5231, pass: 5231 }`.

"No tests found" plus a non-zero exit means the child process died *before
registering any subtests* — i.e. during module load, not during a test body.
That points at load-time contention (esbuild/tsx transform, or the shared
`node_modules` under `jobs: 6`) rather than the slow-start theory above, and it
is a nastier failure mode: a file that reports zero tests looks like an empty
file rather than a crash, so a reader can mistake it for "nothing to run."

Practical consequence for agents in the meantime: **a red parallel run is not
evidence of a regression.** Confirm with `-j1` before believing it. That
convention costs a re-run; misreading a phantom failure as your own bug costs
much more.

## Another occurrence: TAP file timeout during CLI build (2026-08-05, worktree `ios-landmark-resume`)

The full `pnpm test` run timed out this file after 300 seconds. The first and
only test was still running its setup expression at
`test/hub/hub-e2e.doctest.md:109`:

```text
not ok 1 - hub-e2e.doctest.md:109 — await execFileP("node", ["scripts/build-cli.mjs"], { cwd: PACKAGE_ROOT })
not ok 462 - timeout!
expired: test/hub/hub-e2e.doctest.md
```

The branch did not touch this test or the code that it exercises. An immediate
isolated run passed 8/8 in about 96 seconds. This is a third parallel-load
symptom: the process registered its test, but the setup and hub exercise did
not complete within TAP's five-minute file timeout.
