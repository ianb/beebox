---
title: "schedules.test.ts 'a timeout kills the whole process group' flakes under load (grandchild.pid not yet written)"
workstream: unattached
priority: important
---
`bin/schedules.test.ts` → "a timeout kills the whole process group, not just the
run script" fails with `ENOENT … grandchildjob/grandchild.pid` when the machine
is loaded (load avg ~50, several worktrees running suites), and passes on
re-run with no code change. Seen 2026-08-25 at the fix for the leaked
`ackjob` desktop notifications.

The test presumably reads the grandchild's pid file on a fixed delay that the
grandchild hasn't reached yet under contention. Wait for the file (poll with a
bound) rather than assume a delay. Also a data point for the test-economics
workstream: load-induced flakes are indistinguishable from real failures.

## Found fixed in code, 2026-09-11 (survey note, not closed)

The fixed delay this issue blames is gone. `bin/schedules-hardening.test.ts:249-257`
polls for `grandchild.pid` — up to 80 attempts at 50ms — which is exactly the
remedy this issue asked for.

Behavioral evidence the same day: this test was the sole failure in a batched
full-suite run on a heavily loaded machine, then passed 12/12 in three
consecutive isolated runs. Consistent with the remaining failure being a
host-load SIGKILL of the whole run (see the 31-file environment alert of
2026-09-11), not the race described here.

Left open rather than closed: the tracked-flake protocol wants a clean run under
the conditions that used to produce it, and the machine has not been quiet
since. Whoever picks this up should confirm, then close as implemented naming
the commit that introduced the polling loop.
