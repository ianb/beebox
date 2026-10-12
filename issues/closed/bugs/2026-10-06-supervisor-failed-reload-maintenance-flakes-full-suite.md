---
title: "supervisor doctest: work is admitted right after a failed reload reports an exclusive maintenance phase, under full-suite load"
workstream: flaky-tests
area: beebox
labels: [tests, flaky]
filed-by: agent
discovered-by: agent
discovered-in: worktree-test-suite-health — the batch's one full `pnpm test` run, 2026-10-06
priority: important
resolution: implemented
---

`beebox/test/hub/supervisor.doctest.md` failed in a full beebox suite run on
2026-10-06 and passed alone right after (63/63 with
`migrations.timeout.doctest.md`). The test ledger records 12 failures in 278
runs since 2026-09-20.

The failing assertion is the last one in the reload block (line 274). After a
reload whose replacement fails readiness, the test waits until the supervisor
reports `unhealthy` and `boxMaintenanceStatus(...).phase === "exclusive"`. It
reads `exclusive` (line 271 passes), then calls
`acquireBoxWork(reloadFixture.root, { reason: "test" })` and expects
`BoxMaintenanceError`. Under load it got no error: work was admitted while the
box had just reported exclusive maintenance.

So the maintenance state changed between the status read and the acquire, or
`acquireBoxWork` admits work in a state the status call reports as
exclusive. A time-based expiry of the maintenance record would fit a
load-only failure. That is not confirmed.

Find which, before changing the test. If an exclusive phase can lapse on its
own after a failed reload, decide whether that is intended: work admitted
into a box whose reload failed is a product question, not only a test one.

Closed predecessor with a different mechanism:
[supervisor and git-lock flakes](2026-08-18-supervisor-and-git-lock-doctests-flake-full-suite.md).

## Re-encounter (2026-10-07)

In worktree-box-first-load, the same assertion (`supervisor.doctest.md:274`,
`acquireBoxWork` after the failed reload, "no error thrown") failed in 1 of 3
runs of only `test/hub/health.doctest.md`, `test/hub/server.router.doctest.md`
and `test/hub/supervisor*.doctest.md` in parallel. It passed alone. Full-suite
load is not required: a few parallel files on a loaded machine are enough.
The branch added launch timing fields to the supervisor; it changes no
maintenance or reload logic.

## Resolution (2026-10-12)

The second reading in the report was right, and it is intended behavior.
After the replacement fails readiness, `reloadSupervisedBox` marks the box
unhealthy, writes the `exclusive` phase, and then releases the owner lock
in `finally`. Since `box-maintenance-no-wedge` (2026-09-17), a phase record
without a live owner refuses nothing. That plan lists "Dev reload
replacement not ready" as one of the closure paths it removed on purpose.
So the box reopens with unfinished maintenance. The test waited for
`phase === "exclusive"` and expected `acquireBoxWork` to refuse. It passed
only when the acquire ran in the window between `beginChanges()` and
`release()`. No time-based expiry is involved.

The test now waits for `owner === null`, then asserts the record
(`exclusive`, unowned) and that work is admitted. `BoxReloadError` and
`bbx maintenance` still said the box "remains closed for recovery". That
stopped being true on 09-17, and both now say it reopens with unfinished
maintenance.

Repetition: 6 copies of the old file and 6 of the new, in parallel, 10
rounds: old failed 25 of 60 at line 274, new failed 0 of 60.
