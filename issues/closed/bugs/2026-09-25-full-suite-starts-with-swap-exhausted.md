---
title: "The hourly full suite starts on a host with swap nearly exhausted, because its quiet-host gate only refuses critical memory pressure"
workstream: test-suite-health
area: beebox
labels: [full-suite, schedules, host-load]
filed-by: agent
discovered-by: Ian
discovered-in: main — "this computer got really slow", 2026-09-25
priority: important
resolution: implemented
---

**Closed 2026-10-06:** fixed by commit 374284c3a. `isHostQuiet` now blocks on memory pressure at warn or above, free swap under 2 GB, and a pageout rate of 100 pages/s or more between two polls 5 s apart (unknown signals never block). A machine-wide `full-run` lock in `bin/test-locks.ts` keeps the schedule's run and a worktree's whole-tier `pnpm test` from overlapping: the schedule defers its tick when the lock is held, the worktree wrapper waits at most 45 minutes. Evidence: `node --import tsx --test bin/host-pressure.test.ts bin/test-full-run-lock.test.ts bin/test-locks.test.ts bin/test-tiers.test.ts schedules/full-suite/*.test.ts` passed (128 tests, a case per signal and the lock against a real directory); a live read of `vm.swapusage` and `vm_stat` parsed on this host. **Amended 2026-10-06:** the free-swap floor was removed with the boxholder's agreement. macOS adds 1 GB swap files on demand, so free swap sits near 1 GB however loaded the host is, and the floor refused nearly every run. The gate now reads load, pressure and the pageout rate, and since `cc76c1242` it also applies to a worktree's whole-suite `pnpm test`, which refuses with its reasons and the `BBX_TEST_IGNORE_LOAD=1` override. Mid-run abort was not done: [the full suite does not re-check the host during a run](../../bugs/2026-10-06-full-suite-does-not-recheck-host-during-run.md).

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

Related: [fixed timeout budgets fail under host load](../../bugs/2026-09-02-fixed-timeout-budgets-fail-under-host-load.md).
