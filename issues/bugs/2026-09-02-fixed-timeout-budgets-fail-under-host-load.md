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

## What stays open here

`/finish`-style full-suite runs in worktrees have no load gate — a developer
or agent running `pnpm test` on a loaded machine still sees these timeouts and
has to recognize them (isolated re-run on a quieter host, or check `uptime`).
If that keeps costing triage time, the same slowdown measurement the schedule
uses could be surfaced by the ledger wrapper as a "this run was ~N× slow"
banner on the summary. Per-test budget scaling was considered and rejected as
gold-plating. Related per-test items:
[process-group timeout](2026-08-25-schedules-process-group-timeout-test-flaky-under-load.md),
[router shutdown](2026-08-24-router-core-shutdown-test-flakes-under-load.md),
[awake timeout](2026-08-20-awake-timeout-doctest-flakes-on-a-cold-run.md).
