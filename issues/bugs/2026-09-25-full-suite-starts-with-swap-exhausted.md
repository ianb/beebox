---
title: "The hourly full suite starts on a host with swap nearly exhausted, because its quiet-host gate only refuses critical memory pressure"
workstream: unattached
area: beebox
labels: [full-suite, schedules, host-load]
filed-by: agent
discovered-by: Ian
discovered-in: main — "this computer got really slow", 2026-09-25
---

On 2026-09-25 the boxholder's Mac (16 GB RAM) became very slow. At that
moment:

- swap was 16.27 GB used of 16.38 GB (112 MB free);
- load average was about 29 on 12 cores, with `kernel_task` at 189% CPU;
- the `doc-structure` worktree was running a full `tap` run;
- about ten agent sessions were open.

The hourly `full-suite` schedule had started its own full run about four
minutes earlier. It was stopped by hand.

Its log shows the gate passed:

```
full-suite: host quiet (load1 7.5, pressure 2, pageouts 10160502).
full-suite: tier start (pressure 2, pageouts 10191863).
```

## Why the gate let it through

`isHostQuiet` (`schedules/full-suite/lib.ts:45`) accepts the host when
`load1 <= cores` and memory pressure is below **critical**. At the check,
load was 7.5 (under 12) and `kern.memorystatus_vm_pressure_level` was 2
(warn). Warn passes. Swap was already nearly full, and the pageout counter
was over 10 million, but neither is part of the decision:
`readMemoryPressure` (`bin/host-pressure.ts:42`) reads the counter only for
the log.

The check is also a single point in time. Load rose to about 29 after the run
started, partly because another worktree started its own full suite. Nothing
re-checks during the run.

## Directions

- Treat warn pressure, or swap free below some floor, as not quiet, at
  least for the full suite.
- Use the rate of pageouts (the change between two polls), not the lifetime
  counter, as a thrash signal.
- Keep checking during the run, and stop the run as deferred when the host
  becomes thrashed, instead of finishing a run whose verdicts would be
  withheld anyway.
- Consider a host-wide lock so that two full suites (the schedule and a
  worktree's own run) do not run at once.

Related: [fixed timeout budgets fail under host load](2026-09-02-fixed-timeout-budgets-fail-under-host-load.md).
