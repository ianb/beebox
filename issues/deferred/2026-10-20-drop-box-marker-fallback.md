---
title: "Drop the `.beebox/box.json` marker fallback after box-shape-record-2026-10"
workstream: unattached
activate-on: 2026-11-20
category: code-quality
area: beebox
labels: [box-shape]
design: ../../beebox/docs/implemented-plans/box-shape-in-package-json.md
filed-by: agent
discovered-by: agent
discovered-in: worktree-bug-burndown-4 — registering the box-shape-record-2026-10 migration (plan Track D)
---

The `box-shape-record-2026-10` migration writes each box's shape version and
birth date into the `beebox` block of its tracked `package.json`. Until every
box has run it, the engine still reads the old gitignored marker
`.beebox/box.json`, and it still writes one on a fresh init. The migration
leaves the marker on disk, and tracked where it was tracked (production
boxes), so an engine from before the block keeps opening the box after a
deploy rollback (boxholder decision, 2026-10-20).

## What to remove

- The marker branch of `readShapeRecord` and the `hasMarker` discovery
  signal in `probeBoxLevel` and `getBoxShape` (`beebox/src/lib/box-identity.ts`,
  `beebox/src/lib/box-shape.ts`). `BOX_MARKER` then has no reader.
- The marker clause of `refuseV2` (`content/.beebox/box.json`), if no v2
  backup still needs the specific error.
- The transitional marker write in `initBox`'s fresh path and its rollback
  (`beebox/src/core/box/structure/core.ts`, "Transition only").
- The `cp` of the marker into worktree box clones in
  `bin/lib/worktree-create.sh` ("Carry over the box marker").
- A new listed migration that deletes `.beebox/box.json`. Deleting the file is
  a working-tree change the sweep commits, so on a box that still tracks the
  marker the same commit untracks it. (`box-shape-record-2026-10` did not
  untrack it: an untrack that keeps the file on disk is invisible to
  `changedMigrationPaths` and would be left staged.)
- Tests that write markers on purpose to exercise the fallback
  (`useMarkerOnly` in `beebox/test/helpers/test-helpers.ts` and its callers),
  and `diagnoseStrayMarker` if no pre-v3 marker still needs a diagnosis.

## Safe to remove when

Every box that matters has `box-shape-record-2026-10` in its
`_config/migrations.jsonl`, production boxes included, and no deploy rollback
to an engine from before 2026-10-20 is still a possibility.

## What breaks if it is removed early

An unmigrated box has no block. Without the fallback, `getBoxShape` and
`findBoxRoot` refuse it with `MissingShapeRecordError`, so it does not open
and `bbx engine migrate` cannot run on it to fix itself.
