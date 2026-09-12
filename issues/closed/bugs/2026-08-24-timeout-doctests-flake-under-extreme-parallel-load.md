---
title: "test/dev/auto-sweep-detach, test/field-test/lifecycle, test/field-test/run doctests time out under extreme parallel load"
workstream: commit-provenance
area: beebox/test
labels: [flaky, timeout, load]
filed-by: agent
discovered-by: agent
discovered-in: /finish for the commit-provenance-trailers stream, full beebox suite run under load averages 28-40 (many concurrent sibling sessions)
resolution: superseded
---

## What happened

A full `pnpm test` run in `beebox/` (post-merge re-verification for an
unrelated stream) failed 4 of 7886 tests, all timeout-shaped, while system
load averages sat at 28-40 (many concurrent Claude sessions running
tests/lint/typecheck in parallel):

```
not ok 260 - test/dev/auto-sweep-detach.doctest.md # time=24486.648ms
not ok 299 - test/field-test/lifecycle.doctest.md # time=165601.089ms
not ok 302 - test/field-test/run.doctest.md # time=327575.476ms
not ok 619 - timeout!  (expired: test/field-test/run.doctest.md)
```

The whole suite took 1,782,731ms (~29.7 minutes) versus a normal ~207,000ms
(~3.5 minutes) on a quiet machine — roughly 8-9x slower.

`test/dev/auto-sweep-detach.doctest.md:64` polls with a hardcoded timeout
(`await sleep(100)` loop) waiting for a log condition; under 8-9x slowdown the
poll budget is exceeded even though the underlying operation eventually
succeeds. `test/field-test/lifecycle.doctest.md` and
`test/field-test/run.doctest.md` are long-running box-lifecycle doctests that
hit tap's own suite-level timeout the same way.

## Isolation

Re-ran all three files together in isolation (still under load ~36, but with
only those 3 files running instead of the full ~620-file suite):

```
ok 1 - test/dev/auto-sweep-detach.doctest.md # time=12754.655ms
ok 2 - test/field-test/lifecycle.doctest.md # time=29153.589ms
ok 3 - test/field-test/run.doctest.md # time=159092.191ms
# { total: 48, pass: 48 }
```

All pass. The failure is contention from running the full suite alongside
many other concurrent processes, not a logic bug — none of these three files
or the code they exercise were touched by the branch that surfaced this.

## Handling

No fix proposed here — the tests are already timeout-tolerant in isolation;
the issue is fixed-budget polling/suite timeouts under 8x+ external
contention, which is an environment condition, not a product bug. Filing so
a repeat under similar load conditions is recognized as this same flake
rather than re-investigated from scratch. If it recurs often, consider
scaling timeout budgets by measured wall-clock slowdown, or excluding these
tests from concurrent-load runs.

## 2026-09-02 — closed: superseded

Consolidated with the other load-timeout filings into
[fixed-timeout-budgets-fail-under-host-load](../../deferred/2026-09-02-fixed-timeout-budgets-fail-under-host-load.md);
the harness-side fix (quiet-host wait, slowdown-gated verdicts, import-cone
attribution) landed from the full-suite-verdicts workstream.
