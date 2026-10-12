---
title: "The hub kills a box child that is slow to become ready, even when the child is healthy"
workstream: unattached
area: beebox
labels: [hub, flake]
filed-by: agent
discovered-by: agent
discovered-in: worktree-flaky-tests — three real-process doctest flakes shared this cause, 2026-10-12
---

The supervisor gives each box child a fixed 30 seconds to answer HTTP
readiness (`READY_TIMEOUT_MS`, `src/hub/supervisor/child-spawn.ts:58`). When the
limit passes, `launch` counts a failure, kills the child, and schedules a
restart (`src/hub/supervisor/core.ts:429-465`). The limit does not change with
host load, so a child that is still booting and would become ready is treated
as a crash.

## Evidence

- `test/hub/supervisor.maintenance.doctest.md`: with 8 copies in parallel, a
  cold real-server boot took longer than 30 seconds in 16 of 24 runs. The
  supervisor killed the first child before the test's reload began. Two hourly
  full-suite failures (2026-10-08) and one restart that became the "first"
  generation (2026-10-11, `children[0].exitCode` 1) have the same cause. The
  test now uses its own readiness check with a 120-second budget (2a3ecb9a2).
  That fixes the test, not the hub.
- `test/hub.e2e.doctest.md`: once, at a load of about 20, the child did not
  answer `/healthz` within the limit. It was restarted 4 times, and the file
  timed out.
- `test/field-test/run*.doctest.md`: these files time out on the 30-second
  readiness wait at 10 parallel copies. They stay in the careful tier.

## The tension

On a loaded machine (several agents, a full test run, a build), a slow but
healthy box restarts instead of coming up. Each restart repeats the cold boot,
so the extra load makes the next attempt slower. A longer fixed limit moves the
threshold and still has the same failure mode. A very long limit makes a
child that is truly stuck take longer to recover.

The child is spawned with an IPC channel (`child-spawn.ts:48`, `ipc: true`),
and the dev-reload path already sends messages over it. The child could report
readiness on that channel. The supervisor could then tell "still booting" (the
process is alive and has not reported) from "stuck" (no progress). That would
need a decision about what counts as progress, and about what limit, if any,
still applies.

## Research (2026-10-12)

The developer asked whether this happens outside tests. The child logs of
the four local boxes on the developer's hub (`<box>/.beebox/hub-child.log`,
2026-07-07 to 2026-10-12, 205 child boots) show no readiness kill.

- A child that the hub kills before it is ready would get SIGTERM before it
  prints "Server running". The parse found two such places. Neither is a
  kill: one is the first line of the log file, and in the other an old
  child closes after its replacement has started.
- Where the log shows the boot time directly (from one child's SIGTERM to
  the next child's "Server running" during a reload), boots take about 3
  to 4 seconds. That leaves a margin of 7 to 10 times under the 30-second
  limit.
- Other gaps between boots are idle time, not boot time. The hub is lazy
  (`idleMs` 300000), so it stops a box after 5 minutes without use and
  starts it on the next request.

The only observed failures are in tests that start 8 to 10 real servers on
one machine at the same time. Those tests now use their own readiness check,
or stay in the careful tier. Production hub logs were not examined.
