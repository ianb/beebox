---
title: "journey-phone-wait fails on main: the runs list has self-off before ran"
workstream: web-guidance-scan
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-web-guidance-scan — change-selected test run
resolution: implemented
---

**Closed (implemented, 2026-11-11):** The wait starts at the real hour; started 10:00–11:00 UTC the 11:00 run comes first. The test now checks which runs happened and that the log is in time order.

`beebox/test/user-stories/journey-phone-wait.test.ts`, test "A wait lives
through the interval in time order, and resumes after a stop", fails on
`main` at `04f01adbc` and on `worktree-web-guidance-scan` (which does not
touch it). Run alone, about 75 seconds, it fails the same way each time:

```text
$.runs: the same items in another order
$.runs[0]: expected "ran <day>T10:00:01.000Z", actual "self-off <day>T11:00:01.000Z"
$.runs[1]: expected "self-off <day>T11:00:01.000Z", actual "ran <day>T10:00:01.000Z"
```

The 11:00 entry comes back before the 10:00 entry, so whatever builds
`runs` is not in time order, or the test's expectation of order is wrong.
Seen 2026-11-11 around 09:00–10:00 UTC; not checked whether it depends on the
wall clock.
