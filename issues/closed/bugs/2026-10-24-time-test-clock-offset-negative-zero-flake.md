---
title: "time.test.ts \"The box clock offset\" fails with -0 under load"
workstream: perf-easy-wins
area: beebox
labels: [tests]
filed-by: agent
discovered-in: worktree-perf-easy-wins — test:changed at load average 15
resolution: implemented
---

Closed: the test's `ahead` helper adds `+ 0`, which turns `-0` into `0` (2026-10-24).


`test/lib/time.test.ts`, subtest "The box clock offset", computes minutes
ahead as `Math.round((getBoxTime(root).getTime() - Date.now()) / 60_000)`.
With no offset, `Date.now()` can run a millisecond after `getBoxTime`, so the
difference is a tiny negative number and `Math.round` returns `-0`. The check
expects `malformed: 0`, and `t.check` tells `-0` from `0`:

```
$.malformed: not equal
  expected: 0
  actual: -0
```

Seen once in a `test:changed` run (2026-10-24); six reruns alone passed. The
fix is in the test's `ahead` helper (normalize `-0`, or compare against a
clock captured once); `careful.txt` says a timing-sensitive file other than
the real-process ones is a flake to fix, not to move to the careful tier.
