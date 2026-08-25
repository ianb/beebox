---
title: "Run the periodic code-health sweeps weekly, and build the thing that runs them"
workstream: unknown
---

2026-08-24 · from the knip-exports workstream (boxholder decision).

knip's `exports` check is on and its report is empty, so from here the
question is when it runs. **Not per-commit.** A dead export is not a broken
build; blocking a commit on one is the wrong severity, and pre-commit is
already slow. The right cadence is **weekly**, as a report someone reads.

That applies to the other entries in `callback-box/docs/maintenance.md` with
no schedule behind them: `lint:knip`, `lint:oxlint`, `lint:circular`. Their
cadence column says things like "Before releases; when code feels
accumulated" — which means "never" in practice, and is why the export backlog
reached 651.

## The missing piece

There is no general way to schedule a dev-repo task. What exists is one
bespoke precedent: `bin/manual-tests-scheduled.sh --install` registers a
launchd job, runs weekly, and files a local issue plus a notification on
failure. `bin/update-agent-sdk-scheduled.sh` is a second, built the same way.
A third hand-rolled launchd script is the wrong answer.

What a general mechanism needs, taking those two as the requirements:

- one place to declare "run X on cadence Y", instead of a script per task
- output that lands somewhere durable and readable, not just a console the
  cron job throws away
- a failure path that reaches the boxholder — the manual-test job's
  file-an-issue-and-notify shape is the model
- something that works when the machine was asleep at the scheduled time
  (launchd's `StartCalendarInterval` fires on wake; a naive timer does not)
- a way to run it on demand, so it is testable without waiting a week

## knip is quiet now

Resolved 2026-08-24 in the knip-exports workstream, so a weekly report starts
from an empty console — every line it prints is a finding.

The noise had one root cause worth recording: `.npmrc` sets
`node-linker=hoisted`, so every package's dependencies install into the ROOT
`node_modules` (`callback-box/node_modules` holds two entries). Run
per-package, knip cannot map a binary a script invokes back to the package
declaring it, and reports the same tool as an unlisted binary AND an unused
devDependency simultaneously — the contradiction was the tell. Moving the
config to the monorepo root fixed that whole class, and turned up three real
bugs on the way: `bin/` imports `better-sqlite3`, `@markdoc/markdoc`, and
`esbuild` without declaring any of them, and the root has a `tsc` script with
no `typescript` dependency. All four resolved only through hoisting.
