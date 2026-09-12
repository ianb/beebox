---
title: "schedules.test.ts 'a timeout kills the whole process group' flakes under load (grandchild.pid not yet written)"
workstream: unattached
priority: important
resolution: implemented
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

## Found fixed in code, 2026-09-11 (survey note — WRONG, see below)

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


## Actually fixed 2026-09-12 — and the 09-11 note above was wrong

The survey note said the fixed delay had been replaced by polling and the issue
probably just needed confirming. Confirming it found the test still failing.

**Reproduced deliberately.** Solo it passes every time (5/5, 12 assertions
each). **Four concurrent copies failed identically, all four**, on the same
assertion: `grandchild.pid` never appearing.

**It was never a timing budget.** Raising the wait to 30 seconds changed
nothing — the file was not slow, it was never written. The fixture's run script
is:

```sh
sh -c "sleep 45" &
echo $! > "$SCHEDULE_STATE_DIR/grandchild.pid"
sleep 45
```

and the test ran it with `timeoutMs: 400`. On a loaded machine the shell does
not reach line 2 within 400ms, so the process group is killed before the
grandchild is ever registered, and the test then waits for a file nothing will
ever write. **The test raced its own setup.**

Fixed by giving the fixture room to register — `timeoutMs: 5_000`, still a tiny
fraction of the `sleep 45` it must cut off, so the assertion about killing the
group is unchanged in substance. Both polls also became wall-clock deadlines
rather than attempt counts (80 attempts at 50ms is 4s only if each iteration is
free; under load the sleeps and reads stretch, so the budget shrank exactly
when it needed to be longest).

**Verified under the conditions that used to fail:** 4 concurrent copies green,
then 6 concurrent copies green, plus solo runs. That is the tracked-flake bar —
a clean run under the conditions that produced it, not just a clean run.
