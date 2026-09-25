---
title: "A failed deploy reports itself as interrupted and silently drops the queued deploy"
workstream: deploy-maintenance-page
area: beebox
labels: [deploy]
filed-by: agent
discovered-by: agent
discovered-in: main — investigating why a merge was on main but not in production
resolution: implemented
---

Closed 2026-09-18: implemented in `a94ba467b`
(`beebox/docs/implemented-plans/deploy-maintenance-page.md`, track D). Signals
are now recorded by a trap (`INT`/`TERM`/`HUP` set `INTERRUPTED_BY`), and
`deploy_exit` branches on that variable rather than `rc >= 128`
(`beebox/deploy/deploy-outcome.sh`). An ssh exit of 255 with no signal now
classifies as `unreachable`/failed, not `interrupted`.

`deploy_exit` in `beebox/deploy/deploy.sh:79-97` treats any exit code of 128
or higher as a signal:

```sh
if [ "$rc" -ge 128 ]; then
  local sig=$((rc - 128))
  echo "Deploy interrupted (signal $sig) — not a failure; the next landing's deploy covers this ref."
```

`ssh` exits **255** on its own failures, so a network failure lands here and is
reported as `signal 127`. Two consequences follow from the same branch:

1. The boxholder is told the deploy was interrupted on purpose and that the
   next landing covers the ref, when in fact the deploy failed.
2. The chaining block below it is guarded by `[ "$rc" -lt 128 ]`, with the
   comment "Signal-style exits mean an operator or supervisor deliberately
   stopped the run." So a queued newer deploy is **not** started.

## Observed

2026-09-16: the deploy of `b301ecf6` died on
`ssh: connect to host … Operation timed out` during a network outage and
logged "Deploy interrupted (signal 127)". The deploy of `0d65810d`, queued
behind it, never ran. Production stayed on `cf190969` — two merges behind main,
including a landed feature — until an unrelated commit triggered a new deploy
hours later. The boxholder's desktop notification said "⏸ interrupted", not
"failed".

## The fix, roughly

Detect real signals from the signal itself rather than from the exit code:
trap `INT`/`TERM`/`HUP` and set a flag, then treat everything else as a
failure. An exit code above 128 from a child process is not evidence that
*this* process was signalled.

While in there: 255 deserves its own message, since "the server could not be
reached" and "the deploy broke" are different things to a person reading a
notification.

Related: [deploy timing record](../code-quality/2026-09-18-deploy-timing-record.md),
[maintenance page](../features/2026-09-18-deploy-maintenance-page.md) (a
deploy that dies this way leaves the marker behind).
