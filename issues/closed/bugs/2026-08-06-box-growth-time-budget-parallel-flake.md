---
title: "Box-growth partial-scan doctest flakes under parallel load"
area: callback-box
filed-by: agent
discovered-in: worktree-router-ws-1006 — finish full-suite re-verification
resolution: implemented
---

Resolved in `e084243e`. The wall-clock partial-retention check now runs
serially in the explicit weekly manual-test allowlist instead of the default
parallel suite. This deliberately preserves occasional coverage rather than
making the fixture deterministic: its 500 ms deadline is too expensive for
every normal test run, and serial execution removes the parallel-load flake.

`test/core/box-growth-health.doctest.md` can fail its partial-scan case under
parallel full-suite load. The fake `find` process emits two directory records
and then sleeps past the scan deadline. In the failed run, the scanner timed out
before it consumed those records. The test expected `false:2:1` and
`box/inbox/email:Box growth scan exceeded its time budget`, but it received
`false:0:0` and `undefined:Box growth scan exceeded its time budget`.

The full suite failed 1 assertion out of 6257 on 2026-08-06. An immediate serial
run passed all 21 assertions in the file, including the partial-scan case. The
test needs a deterministic synchronization point between the fake process
output and the deadline instead of relying on wall-clock scheduling under load.
