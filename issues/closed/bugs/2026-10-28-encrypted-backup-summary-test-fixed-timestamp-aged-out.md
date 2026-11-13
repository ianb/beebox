---
title: "`AdminOverview.encrypted-backup-summary.test.ts` is red: its fixed timestamp aged past the 36-hour window"
workstream: knip-sweep
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-knip-sweep — full suite before landing the 2026-10-28 knip sweep
labels: [test-failure]
resolution: implemented
---

**Closed (implemented, 2026-11-13):** Fixed on main by other work; the full beebox suite and pnpm lint are green on the merged knip-sweep tree (2026-11-13).

`beebox/src/frontend/test/components/admin/AdminOverview.encrypted-backup-summary.test.ts`
fails on main in "summarizes encrypted backup lifecycle". The fixture sets
`newestVerified.verifiedAt` to the literal `2026-10-26T12:00:00.000Z`, and
`summarizeEncryptedBackup` compares it with the real clock. Since
2026-10-28T00:00Z the snapshot is over 36 hours old, so the summary reads
"Latest verified snapshot is over 36 hours old" / `warning` where the test
expects "Verified snapshot available" / `success`.

The test came in with `418139f9c` ("Add owner Admin setup and daily control for
encrypted backups", 2026-10-26). The fixture timestamps need to be relative to
the clock the summary reads, or the summary needs an injectable `now`.

Reproduce: `pnpm -C beebox exec tap src/frontend/test/components/admin/AdminOverview.encrypted-backup-summary.test.ts`.
