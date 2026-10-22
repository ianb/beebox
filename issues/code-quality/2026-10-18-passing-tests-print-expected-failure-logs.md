---
title: "Passing beebox tests print the logs of failures they provoke on purpose"
workstream: unattached
area: tests
priority: backlog
labels: [tests, noise]
filed-by: agent
discovered-by: agent
discovered-in: doctest-typecheck — retire-doctest track 5; a full `pnpm test` run in beebox wrote a 39,245-line log for a green suite
---

Tests that exercise a failure path let the code's own error log reach the
run's output. The test passes, and the output looks like a failure. Seen in
the 2026-10-18 full run:

- `test/connectors/google-calendar.test.ts`: "Pushed annotated.ics to Google
  but could not rewrite it locally: Error: EACCES …" with the error object
  dumped (a read-only file the test sets up).
- `test/core/annex/unlisted-binaries.test.ts`, unreadable-scope case: "Could
  not read …/locked.attach while finding attach scopes, skipping: Error:
  EACCES …" from `src/lib/attach-scopes.ts`.
- `test/core/retro/scan/ledger.test.ts` and `test/core/scan/quarantine.test.ts`:
  "retro: skipping …" and "[scan] Quarantine sidecar …" lines.
- `test/hub/supervisor.test.ts`: "[hub] fixture reload: Replacement did not
  become ready …".

The repo rule is that actionable failures stay visible and routine success is
quiet; here a green run is not quiet, so a real failure's output is harder to
find.

Fix direction: where a test provokes the failure, capture the log the way
`test/helpers/quiet-chat-session-log.ts` does for chat sessions, and check the
captured lines (the log line is part of the contract) instead of letting them
print. Start by listing which test files write to stderr on a green run.
