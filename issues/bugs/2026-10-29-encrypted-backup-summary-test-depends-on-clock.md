---
title: "`AdminOverview.encrypted-backup-summary.test.ts` fails once its hardcoded snapshot date is 36 hours old"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-sdk-update — full suite after the Agent SDK 0.3.311 bump
labels: [test-failure]
---

`beebox/src/frontend/test/components/admin/AdminOverview.encrypted-backup-summary.test.ts`
("summarizes encrypted backup lifecycle") passes a fixture with
`verifiedAt: "2026-10-26T12:00:00.000Z"` (line 38) to
`summarizeEncryptedBackup`, which compares it with the real clock. Since
2026-10-28T00:00Z the snapshot counts as stale, so the check fails for every
run:

- expected `"Verified snapshot available"`, actual `"Latest verified snapshot is over 36 hours old"`
- expected tone `"success"`, actual `"warning"`

The test is new with the encrypted-backup admin work (`418139f9c`, 2026-10-26)
and passed only for its first ~36 hours. The test should pass a fixed "now" to
the summary (or build `verifiedAt` relative to the clock), so the
over-36-hours branch is tested on purpose instead of by the calendar.

Reproduce: `pnpm -C beebox test` (2026-10-29: 13,464 pass, 1 fail, 2 skip).
