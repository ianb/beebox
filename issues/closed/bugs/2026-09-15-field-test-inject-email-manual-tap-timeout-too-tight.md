---
title: "field-test-inject-email.doctest.md can exceed tap's 300s default before its own 15-minute subprocess budget is used up"
workstream: flaky-tests
resolution: implemented
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: weekly manual-test triage — run 20260915-204151, commit 7894bba8f on main
labels: [manual-tests]
priority: normal
---

Weekly `test:manual` (log
`~/src/schedule-runs/manual-tests/runs/20260915-204151.log`) failed with
`test/manual/field-test-inject-email.doctest.md` hitting tap's own timeout at
exactly 299979ms, mid-way through the `injectEmail(...)` step
(`test/manual/field-test-inject-email.doctest.md:117`):

```
not ok 5 - timeout!
  ---
  signal: null
  expired: TAP
```

The file's four earlier assertions (scenario load, box seed, connector
config, baseline sync) had already passed in well under a second; the hang is
inside `injectEmail`, which shells out one connector-scoped `bbx wakeup`
subprocess and then `drainJobs` (up to five more `bbx reactor` cycles),
documented at the top of the file as "roughly two minutes and one agent
session per run... Unattended runtime is ~4 minutes."

## Cause: no timeout override for the manual tier

`test:manual` (`package.json:70`) runs
`BBX_TEST_REAL_HOME=1 tap -j1 'test/manual/*.doctest.md'` with no `--timeout`
flag, so it inherits `.taprc`'s global `timeout: 300` (`beebox/.taprc:55`) —
a budget sized for the ordinary suite under load, per that setting's own
comment ("Five minutes preserves headroom for heavily loaded runs"). That
comment is about the batched/contended suite; `test/manual/**` is excluded
from `.taprc`'s `include:` glob so it never runs there, but explicit
file arguments (what `test:manual` passes) still pick up every other
`.taprc` default, including `timeout: 300`.

Meanwhile the doctest's own internal ceiling for one `bbx wakeup` child is
15 minutes (`WAKEUP_TIMEOUT_MS`, `src/field-test/pre-actions.ts:39`), and the
file's own doc comment budgets ~4 minutes unattended for the whole thing. A
300s outer tap timeout leaves under a minute of headroom against a documented
~240s expectation, on a real API call with two subprocess spawns and up to
five reactor cycles — not enough margin to distinguish "the API was slow
today" from "something hung."

## Not yet known

Whether this run was ordinary variance (real Claude API latency, one slow
reactor cycle) or a genuine hang — the log only shows the outer tap timeout
firing, not where inside `injectEmail`'s subprocess chain the time went. That
needs a re-run with more granular logging (or just re-running this file solo)
before concluding there is a hang rather than a margin problem. Re-check on
recurrence.

## Candidate fix

Give `test:manual` (or this file specifically, via a `tap` per-file
`--timeout`) a budget that matches what the file's own doc comment and
`WAKEUP_TIMEOUT_MS` already assume — e.g. 10–15 minutes — rather than
inheriting the general suite's contention-sized 300s default.

## Resolution (2026-10-12)

`test:manual` now passes `--timeout=1200` (`beebox/package.json`), which
overrides `.taprc`'s 300s (`tap config get timeout` reads 1200 with the flag).
Twenty minutes sits above the file's own 15-minute `WAKEUP_TIMEOUT_MS`, so a
real hang in the wakeup child fails with that budget's readable error rather
than tap's bare `timeout!`. The 300s figure was sized for contention in the
parallel suite, and this tier runs `-j1` against real services. The three
inject-email runs since the failure (2026-09-23, 09-30, 10-07) passed in 158s,
65s and 98s; the 300s overrun has not recurred, which fits variance in the
real agent turn rather than a hang.
