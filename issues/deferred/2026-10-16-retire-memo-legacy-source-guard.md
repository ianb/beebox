---
title: "Remove quick capture's leftover-memo guard after retire-memo-2026-10"
workstream: unattached
activate-on: 2026-11-16
category: code-quality
area: beebox
design: ../../beebox/docs/implemented-plans/retire-memo.md
filed-by: agent
discovered-by: agent
discovered-in: worktree-retire-memo — registering the retire-memo-2026-10 migration (plan Track B)
---

The `retire-memo-2026-10` migration turns every memo card into a doc card,
including quick capture's retained sources. A box whose migration failed
still opens, with its memos in place. For that box, quick capture's source
lookup would find no doc and record the capture as deleted. The lookup
therefore also scans for a `.memo.card` with the capture's `share-id` and
fails with `migration-pending` instead. The guard has no use once every box
is converted.

## Safe to remove when

Every box that matters has `retire-memo-2026-10` in its
`_config/migrations.jsonl`, production boxes included, and the `migrations`
health check reports nothing pending.

## What breaks if it is removed early

On an unconverted box, reconciling a capture whose source is still a memo
marks the capture `gone` ("The saved source was deleted."). A later
successful migration does not undo that, because reconciliation skips gone
records.

## Code that exists only for the old shape (paths under `beebox/`)

- `src/core/quick-capture/source.ts`: `LEGACY_SOURCE_SUFFIX`, the `legacy`
  flag in `findCaptureSource`, and the `migration-pending` throw.
- `src/core/quick-capture/store.ts`: the `migration-pending` entry in
  `CAPTURE_FAILURES`.
- `docs/mobile-contract.md`: the sentence on `migration-pending`.
