---
title: "supervisor doctest: work is admitted right after a failed reload reports an exclusive maintenance phase, under full-suite load"
workstream: unattached
area: beebox
labels: [tests, flaky]
filed-by: agent
discovered-by: agent
discovered-in: worktree-test-suite-health — the batch's one full `pnpm test` run, 2026-10-06
priority: important
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
[supervisor and git-lock flakes](../closed/bugs/2026-08-18-supervisor-and-git-lock-doctests-flake-full-suite.md).
