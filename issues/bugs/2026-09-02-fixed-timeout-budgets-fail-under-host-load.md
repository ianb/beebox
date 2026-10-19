---
title: "Fixed timeout budgets make load indistinguishable from red; consolidated from three filings"
workstream: flaky-tests
area: beebox
labels: [testing, flake, timeout, load]
filed-by: agent
discovered-by: agent
discovered-in: worktree-full-suite-verdicts — consolidating the 08-24/08-25 load-flake filings
priority: important
---

> **Naming note (2026-10-18):** doctests (`*.doctest.md`) are now `.test.ts` files with `t.check`, in the same directory under the same base name, and `agent-doctest` is now `tap-check/` (`@ianbicking/tap-check`). See `beebox/docs/implemented-plans/retire-doctest.md`.

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
[process-group timeout](../closed/bugs/2026-08-25-schedules-process-group-timeout-test-flaky-under-load.md),
[router shutdown](../closed/bugs/2026-08-24-router-core-shutdown-test-flakes-under-load.md),
[awake timeout](../closed/bugs/2026-08-20-awake-timeout-doctest-flakes-on-a-cold-run.md).

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

**2026-10-10 (retrospective 20261010-224248):** the smoke walk's 120 s budget
shows the same pattern at finish time. "A card opens and renders" missed the
budget after a cold start (agents-md/20261009T233917Z-landed.md, passed at
119.3 s on rerun; agents-md/20261010T045428Z-landed.md) and while another
worktree's finish-verify used the shared dev router
(hq-always/20261010T143901Z-landed.md, 70 s once it finished). Per-step timing
in the smoke report would separate load from a real red.

**2026-10-12 (finish-tooling):** done for the smoke walk's report only. Each
step's line now gives its own time and its median from the run log
(`ok   a card opens and renders (39.8s; usual 21.8s)`), and a red step's
line adds the walk total. When smoke is red, `bin/finish-verify` prints those
lines under its FAIL line, and it names any other finish-verify run that
shares the dev router. The budgets and the rest of this issue are unchanged.

## 2026-10-18 (flaky-tests): the recurring victims, file by file

Hourly full-suite alerts since 2026-09-20 and the ledger named about ten
files that failed more than once. Each was traced to a test-caused timing
dependence, not to load alone:

- `test/core/box/file-watcher.test.ts`: one write, then a wait for its real
  FSEvents delivery; libuv drops lost batches silently. Now rewrites until
  delivered; watched-set tests use the fake watcher (`21d12d818`).
- `test/hub/supervisor*.test.ts`: waited on a phase written before the owner
  lock was released (fixed 2026-10-12, `b7783f446`, `e58f6b879`); two
  remaining fixed sleeps now wait on the end state (`5e1ff6bdf`).
- `src/frontend/test/lib/trpc/client.directory-resolution.test.ts`: 12 cold
  tsx children under a 15 s SIGKILL; it could not detect the bug it was
  written for. Deleted (`68961cad6`).
- `test/cli/lib/session-retention.test.ts`, `session.oversize-lines.test.ts`:
  a heap cap on a tsx child. Replaced with a peak-live-heap measurement
  (`14b6ea5ec`).
- `test/lib/git-stale-lock.test.ts`: system-wide `lsof` under a 5 s budget;
  fixed 2026-10-12 (`d62933815`), no failure in 131 runs since.
- `bin/test/lib/auto-sweep-detach.test.ts`: a 1500 ms return bound; now an
  event-order check (`9f04ae4af`).
- `test/deploy/nginx-site.test.ts`: pooled keep-alive connections closed by
  `nginx -s reload`; now fresh connections (`a145d9e9a`).
- `test/core/last-audio-pending.test.ts`: fixed 2026-10-12 (`a0eb972de`).

The `docs-refresh` and `install-validation-hooks` failures were 10-minute
"timeout!" kills in runs 20261014-145730 and 20261005-201105, where 36 and
13 files timed out together: a host stall, not the files.
