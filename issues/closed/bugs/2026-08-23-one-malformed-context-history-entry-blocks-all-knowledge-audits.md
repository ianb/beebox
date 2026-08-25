---
title: "One malformed context-history entry blocks every knowledge audit"
workstream: connector-integrity
area: callback-box
filed-by: agent
discovered-by: agent
discovered-in: worktree-connector-sync-isolation — running the new Drive lifecycle knowledge audit
priority: normal
resolution: implemented
---

**Closed 2026-08-25** in b9c583f6: the row was mangled by a merge-conflict resolution (restored from the pre-merge commit); entries are now validated one at a time (warn + skip), and `recordRun` validates before writing.

The knowledge audit can complete its agent check and then fail the entire command while it records context history. `loadHistory` in `callback-box/src/dev/lib/context-history.ts` parses the complete committed ledger with one strict Zod schema. One existing `points-at-ui-path-vs-control` entry in `callback-box/src/dev/context-history.yaml` has `initial` and `peak` but no `added` or `turns`. The parser rejects that entry, so it prevents a new, unrelated audit measurement from being recorded.

Observed on 2026-08-23: `drive-untrack-and-restore` printed a passing result, then `recordRun` failed in `loadHistory` with `expected number, received undefined` for the older entry's `added` and `turns` fields. The command exited 1 and did not record the passing run.

The right recovery policy is not established. Options include repairing the committed datum, accepting and normalizing an older entry shape at the read boundary, or isolating one malformed audit record instead of rejecting the whole ledger. The implementation should also determine how the incomplete record was written before choosing whether schema compatibility or write durability is the primary defect.
