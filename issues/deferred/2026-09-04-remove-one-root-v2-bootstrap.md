---
title: "Remove the one-root migration's v2 bootstrap path"
workstream: box-layout-criteria
activate-on: 2026-10-05
category: code-quality
filed-by: agent
discovered-by: Ian
discovered-in: box-layout-criteria — Track E of docs/plans/one-root-box-layout.md (or docs/implemented-plans/ once moved)
---

Track E of the one-root migration (`docs/plans/one-root-box-layout.md`)
added a v2-tolerant bootstrap path that exists ONLY to let `bbx migrate`
reach a v2 box the v3 engine otherwise refuses outright. Once every box that
matters has run the `one-root` migration (recorded as `one-root` in its
`_config/migrations.jsonl`), this is dead code carried for boxes that no
longer exist.

**The exact code that exists only for the v2 shape:**
- `beebox/src/core/migrations/one-root-v2-probe.ts` — the whole file
  (`probeV2Box`, `V2Box`).
- `beebox/src/core/migrations/one-root-run.ts` — `runOneRootMigration` and
  everything it calls (`preflight`, `planMoves`, `executeMoves`,
  `mergeClaudeMd`, `moveBeebox`, `bumpMarker`) — the whole file.
- `beebox/src/core/migrations/one-root-mapping.ts` — the whole file
  (`mapV2Path` and the frozen v2 `BOX_LAYOUT` snapshot).
- `beebox/src/core/migrations/one-root-ref-rewrite.ts` and
  `one-root-link-gate.ts` and `one-root-manifests.ts` — the whole files
  (link-gate reuses production `card-lint`/`validate-markdown` machinery
  that stays; only the one-root-specific wiring goes).
- `beebox/src/cli/commands/migrate-bootstrap.ts` — the whole file
  (`findV2Box`, `runBootstrap`).
- `beebox/src/cli/commands/migrate.ts` — `resolveTopPathOrBootstrap` and its
  call site in the `migrate` action (revert to a plain
  `const topPath = await requireBoxRoot();`).
- `beebox/scripts/migrate/one-root.ts` — the whole file, and its `MIGRATIONS`
  entry in `beebox/src/core/migrations.ts` (that entry itself stays forever,
  append-only — only the runnable *script* becomes a retired tombstone like
  `box-packageify.ts`, not the registry line).
- `beebox/src/lib/box-shape-errors.ts` — `V2PackageRootError`/`PreV3ShapeError`
  and `beebox/src/lib/box-shape.ts`'s v2-marker-detection branch in
  `getBoxShape` are Track A's, not Track E's, and stay regardless — they are
  the permanent "refuse a v2 box loudly" behavior, not migration tolerance.
  Don't touch those when clearing this issue.

**The migration's manifest name:** `one-root` (see `MIGRATIONS` in
`beebox/src/core/migrations.ts`).

**What makes it safe to remove:** every box that matters records `one-root`
in `_config/migrations.jsonl` — check the fleet (server boxes + any
developer's local `~/src/boxes/*`/`~/src/box-worktrees/*/*` still in active
use), not just a green local sweep; per `docs/migrations.md`, a box that was
dirty at deploy time is skipped and retried, so `grep` for boxes still
missing the entry before assuming the fleet converged. The fleet-rollout
runbook this plan calls for (merge to main, then immediately run the fleet
migration server-side) is what actually retires the v2 population — this
issue's activation date is a floor, not a signal that the rollout happened.

**What breaks if removed too early:** any box still on shapeVersion 2 loses
`bbx migrate`'s only path to convert — `getBoxShape` already refuses it
outright (Track A, permanent), so a v2 box would be permanently stuck with
no way forward except restoring this code from git history.
