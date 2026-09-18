---
title: "Schedule alerts arrive whenever a condition changes; the boxholder wants a daily cadence"
workstream: schedule-alert-signal
area: router
labels: [schedules]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder wants a once-a-day cadence, not continuous alerts
---

The boxholder does not want to handle schedule alerts continuously. Once a day
is the wanted cadence, with an exception for something that genuinely cannot
wait.

## Where the noise comes from

Per-condition suppression already exists and works. `full-suite` raises one
alert per condition per 24 hours, keyed by kind plus the failing file set
(`schedules/full-suite/trust.ts:144`, `alertFingerprint`), and logs
"unchanged condition … alert suppressed" otherwise. What still reaches the
boxholder:

1. **Several kinds in one day.** Each kind has its own 24-hour window, so a
   timeout at 02:05 and a red-unattributed at 03:55 are two alerts about the
   same unhappy night (2026-09-18). `full-suite` alone has kinds for timeout,
   flaky-green-after-rerun, red-attributed, red-unattributed, and environment
   failure (`schedules/full-suite/red.ts`, `run.ts:175`).
2. **Several schedules.** Each raises independently. Five alerts arrived
   between 02:05 and 18:29 on 2026-09-18 from four schedules.
3. **Nothing ever clears.** 38 open `full-suite` alerts are held, 92 in the
   store. Acknowledging is manual (`bin/schedules ack`), so the list is a
   graveyard and a new item does not stand out in it.

## Directions to weigh

- **A digest.** Schedules write findings to durable state every run; one
  digest alert per day per schedule, or one across all schedules, reports what
  changed since the last digest. The run records already prove each run
  happened, so a suppressed finding is not a lost one.
- **Escalation for the exception.** One defined class interrupts the cadence —
  for `full-suite`, red attributable to a specific landing is the candidate,
  because that is the one a person can act on immediately. Everything else
  waits for the digest.
- **Aging.** An alert whose condition has cleared should close itself rather
  than wait for `ack`. A condition that persists for weeks should escalate or
  go terminal, per the boxholder's "nothing retries forever" rule, instead of
  re-raising daily forever (the `box-convergence` `needs-procedure` alert has
  done exactly that since 2026-09-16).

Severity would make the cadence easier to state: `error` interrupts, `warning`
and `notify` wait for the digest. See
[alert severity and presentation](2026-09-18-schedule-alert-severity-and-presentation.md).
