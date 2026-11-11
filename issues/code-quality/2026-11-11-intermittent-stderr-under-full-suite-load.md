---
title: "Two warnings still reach a green full run's stderr, only under full-suite load"
workstream: unattached
area: tests
priority: backlog
labels: [tests, noise]
filed-by: agent
discovered-by: agent
discovered-in: worktree-test-quiet — verification full run, 2026-11-11
---

After test-quiet, a green full beebox run printed two lines to stderr from
passing tests. Neither came out when the likely files ran alone, nor in six
parallel runs of `bulk-upload.test.ts`, `quick-chat.submit*.test.ts` and
`clerk.send.test.ts`. The diagnostic run that tagged every stderr line with
its test file did not catch them, so their files are unknown.

- `[quick-chat] Could not retain assigned chat identity: Error`, from
  `observeAssignedSession` (`beebox/src/core/chat/session/deliver-user-message.ts`).
  The `session-assigned` handler fired after the test was done. Likely cause:
  test cleanup races the retention write. The line names only `error.name`,
  so it does not say what failed.
- `[bulk-upload] could not send the failure notice for <id>: MissingShapeRecordError: Box at …/bbx-route-test-… has no recorded shape version`,
  from `markBulkPreparationFailed` (`beebox/src/core/bulk-upload/worker/core.ts`)
  in a box from `test/helpers/test-server.ts`. Route-test boxes have no
  `package.json` shape, so a bulk preparation that fails after the test's own
  checks cannot plan its notice.

To find the file, add the stderr-tagging preload (it prefixes each line
with `process.argv`'s `.test.ts`) to `.taprc`'s `node-arg` for one full run.
