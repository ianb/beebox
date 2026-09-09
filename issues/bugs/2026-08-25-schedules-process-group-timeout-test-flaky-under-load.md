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
