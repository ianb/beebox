---
title: "The encrypted backup overview test hardcodes a snapshot date and fails 36 hours later"
workstream: unattached
area: beebox
labels: [tests, flake]
filed-by: agent
discovered-by: agent
discovered-in: "notify-settings, change-selected tests, 2026-10-30"
---

`beebox/src/frontend/test/components/admin/AdminOverview.encrypted-backup-summary.test.ts:38`
passes `verifiedAt: "2026-10-26T12:00:00.000Z"` and expects "Verified snapshot
available". `summarizeEncryptedBackup` compares that date with the real clock,
so since about 2026-10-28 it returns "Latest verified snapshot is over 36 hours
old" and the test fails on any branch that selects it.

Fix direction: compute `verifiedAt` relative to now, or pass the clock in.
