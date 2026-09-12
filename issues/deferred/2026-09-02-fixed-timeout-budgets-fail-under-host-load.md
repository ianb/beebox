---
title: "Fixed timeout budgets make load indistinguishable from red; consolidated from three filings"
workstream: test-overload
area: beebox
labels: [testing, flake, timeout, load]
filed-by: agent
discovered-by: agent
discovered-in: worktree-full-suite-verdicts — consolidating the 08-24/08-25 load-flake filings
priority: important
activate-on: 2026-09-18
category: bugs
---

Three filings (2026-08-24 ×2, 2026-08-25, now closed as superseded by this one)
reported the same finding with different victim files: under concurrent
worktree load (load averages 19–40, up to 11 sibling `pnpm test`/lint
processes), tests with fixed wall-clock budgets time out — and the victims are
whichever files happen to be running when contention peaks, not a property of
the files. Observed victim sets: field-test/run + hub-e2e; auto-sweep-detach +
field-test/lifecycle + field-test/run; six webapp auth/push/CSP doctests. The
2026-08-31 false reds (file-watcher, trpc-directory-resolution — both closed)
were the same condition escalated into wrong `important` issues by the
full-suite harness.

The mechanism: these tests assert real behavior (fs.watch delivery, child
loader boots, server readiness) against budgets that implicitly assume a
healthy host. Under an 8–9× wall-clock slowdown the budget expires while the
behavior is still correct.

## Are the timeout-budget tests valuable, and when?

Yes — conditionally. They cover integration surfaces nothing else reaches
(real watcher delivery, the TSX loader regression, server boot wiring), and a
genuine hang looks identical to a slow host in every signal *except* host
health. Their verdicts are meaningful exactly when the host is demonstrably
healthy, and meaningless otherwise. As of this workstream that condition is
measured rather than assumed:

- The heavy/timing-sensitive files already run in the exclusive careful tier
  (mechanism C), so ordinary-suite contention does not touch them.
- The hourly full-suite run now waits (bounded) for a quiet host, withholds
  all verdicts from a run whose own per-file durations show a thrashed host
  (`schedules/full-suite/trust.ts`), and only blames a landing whose diff
  reaches the failing file through the import graph.

So no test is deleted and no budget is inflated: the tests stay strict, and
the harness only consults them when their premise holds.

## 2026-09-11: memory pressure, not load average

The 09-09 and 09-11 environment reds (25 and 31 files SIGKILLed at tap's 300s
budget) happened AFTER the quiet-host wait passed: the 09-11 log shows load1
falling under the bar after 8 minutes while 18 GB of 19 GB swap was in use.
Load average measures runnable processes; a swapping host is slow at load 8.
Built in workstream test-overload (design in the session's proposal, reviewed
by Codex):

- `bin/host-pressure.ts` reads `kern.memorystatus_vm_pressure_level` (1
  normal, 2 warn, 4 critical) and `vm_stat` pageouts; null on any failure.
- The schedule's quiet wait requires load under the bar AND pressure below
  critical, logs level and pageouts every poll, and after the 40-minute
  budget defers to the next tick (one fyi alert, repeat-suppressed) instead
  of running anyway. A tier that exits non-zero with no TAP output is refused
  rather than read as green.
- `bin/test-ledger.ts` refuses a `--mode full` run under critical pressure
  (`BBX_TEST_IGNORE_LOAD=1` overrides) and prints a one-line warning under
  warn; selected runs never refuse.

Critical rather than warn as the threshold because level 2 reads on a calm
afternoon here. Whether the incidents reach critical is unknown; the per-poll
log line answers that after a week. If they only reach warn plus a pageout
burst, the clause moves to a pageout delta between polls.

## What stays open here

The post-run "this run was ~N× slow" banner for ad-hoc runs is not built: it
needs a source-parameterized `durationHistories` and parsed durations plumbed
out of the wrapper (~50 lines). Build it only if mid-run pressure onset keeps
showing up after the gates above. Per-test budget scaling was considered and
rejected as gold-plating. Related per-test items:
[process-group timeout](../bugs/2026-08-25-schedules-process-group-timeout-test-flaky-under-load.md),
[router shutdown](../bugs/2026-08-24-router-core-shutdown-test-flakes-under-load.md),
[awake timeout](../bugs/2026-08-20-awake-timeout-doctest-flakes-on-a-cold-run.md).

## Check-in on 2026-09-18

Grep every full-suite run log kept since this deferral, plus the deferred fyi
alert:

```sh
grep -H 'full-suite:.*pressure' ~/src/schedule-runs/full-suite/runs/*.log
grep -lE 'withholding verdicts|deferred to the next tick' ~/src/schedule-runs/full-suite/runs/*.log
bin/schedules alerts --json --workstream full-suite | jq 'map(select(.kind == "deferred"))'
```

Answer from that output:

1. **Did any run defer (gate fired)?** If `deferred to the next tick` never
   appears, the critical-pressure gate never fired in a week of real ticks —
   keep it as designed, nothing to change.
2. **Did any run that withheld verdicts (load-slowdown untrusted) show
   pressure below 4 at start or end?** If so, the incidents are real but stay
   under the critical threshold — the gate is too loose for what actually
   happens; move the clause to a pageout-delta between polls instead of the
   bare level-4 threshold.
3. **Did any deferred or refused run happen while the surrounding runs' logged
   pressure would have allowed a good run (i.e. a spurious spike, not a
   sustained one)?** If so, the gate is too tight — require pressure to stay
   at or above critical across two consecutive polls before deferring, rather
   than any single poll.

If none of 1–3 turns up evidence either way (no full-suite runs logged this
week), re-defer one more cycle rather than closing on no data.
