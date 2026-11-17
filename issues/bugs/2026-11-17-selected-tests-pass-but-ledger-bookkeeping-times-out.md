---
title: "Selected tests pass but test-ledger bookkeeping times out"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-theme-check-gate — validating composer material changes
---

`pnpm test:changed` selected 23 frontend files and passed all 189 assertions
in about 32 seconds. Afterward it printed:

```text
test-ledger: not recorded (LedgerTimeoutError: ledger bookkeeping exceeded 60000ms)
```

The test result is available in TAP output but does not reach the test ledger.
Local evidence: `scratch/ambient-theme/tests.log`. This workstream does not
change the selector or ledger. The source graph selection was also slow, but
its relationship to this timeout is unverified.

Inspect the bookkeeping timeout in `bin/test-ledger.ts` and its child process
and lock waits before changing the budget. Preserve the passing assertion
result while making the missing record actionable.
