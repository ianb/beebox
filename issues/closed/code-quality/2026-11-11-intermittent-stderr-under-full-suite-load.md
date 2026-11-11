---
title: "Two warnings still reach a green full run's stderr, only under full-suite load"
workstream: test-quiet
area: tests
priority: backlog
labels: [tests, noise]
filed-by: agent
discovered-by: agent
discovered-in: worktree-test-quiet — verification full run, 2026-11-11
resolution: implemented
---

**Closed (implemented, 2026-11-11):** Both lines were cleanup races in tests. bulk-upload.test.ts stopped waiting once the batch reached failed:*; the worker sends its failure notice after that, and a cleanup that deleted the box first made the notice fail (route-test boxes do have a shape; the box was gone). The wait now lasts until the notice is in the box's log. worker.context.test.ts (post-send) returned once the delivery's own save named the chat, before the background retention write; it now waits for that write and checks the final record. The quick-chat line now adds the errno code (e.g. 'Error (ENOENT)') and has its own check in deliver-user-message.test.ts.

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
