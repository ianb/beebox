---
title: "The box marker lives in the gitignored `.beebox/`, so a clone of a box is not a box"
workstream: bug-burndown-4
area: beebox
priority: important
labels: [box-shape, git]
filed-by: agent
discovered-by: agent
discovered-in: worktree-bug-burndown-4 — split from the rename/gitignore issue, 2026-10-20
resolution: implemented
---

**Closed:** Implemented per `beebox/docs/implemented-plans/box-shape-in-package-json.md` (c634cdd67, b5019ff09, 1c5e90e8a). Divergence from the recorded decision: the migration does not `git rm --cached` the marker and does not delete it; the boxholder chose to keep the file on disk for a month for rollback. `issues/deferred/2026-10-20-drop-box-marker-fallback.md` (activates 2026-11-20) deletes it with the fallback. Rollout prerequisite: a clone is recognized only after its source box is migrated.

Split from
[the rename/gitignore issue](2026-09-03-rename-left-old-gitignore-boxes-commit-state-dir.md),
which carries the full history. The decision below was made there on
2026-09-13 ("The marker decision"); this issue is its implementation.

## Problem

Whether a directory is a box, and which layout it has, is read from
`.beebox/box.json`. Box `.gitignore` ignores `.beebox/` as a directory, so a
`git clone` of a box has no marker and `detectBoxTarget`, `isValidBox`, and
the scheduler do not treat it as a box. `bbx init` on such a clone refuses
with "already has a package.json". `bin/lib/worktree-create.sh` copies
`box.json` into worktree clones to hide this; a hand-made disposable copy
does not get one
([knowledge-audit clone issue](2026-10-09-knowledge-audit-refuses-fresh-worktree-box-clone.md)).

The marker's fields are not machine-local: `version: "1.0.0"` is a literal
shown on the dashboard as "v1.0.0", `created` is the box's birth date, and
`shapeVersion` describes the tracked tree.

## Decided shape

**Identity** moves off the marker. A box is a directory whose `package.json`
declares a `beebox` dependency (or the retired name `LEGACY_PACKAGE_NAME`
accepts) AND has a structural sibling (`_config/` at the same root;
`content/config/` for v2). `getBoxShape` already reads the dependency.

**Layout version** moves to tracked space as a
`"beebox": { "shapeVersion": 3, "created": "…" }` block in `package.json`. Not
in `_config/box.json`: `_config/` is itself shape-dependent. `version` is
dropped. Keep `NewerShapeRequiredError`: an older engine opening a newer box
still refuses.

**Migration** cannot go in the manifest-driven `MIGRATIONS` list, because
`getBoxShape`/`findBoxRoot` must resolve the box before `bbx migrate` runs.
Read tracked-first with a fallback chain (`package.json` block →
`.beebox/box.json` → the v2 probe). Write the tracked field in `bbx init` and
in a new listed migration that also `git rm --cached`s the marker where it is
still tracked, then deletes it. Drop the fallback once the fleet converges.
Writing `package.json` from inside `migrateBoxState` was rejected: it puts a
tracked-file write on a lazily invoked resolver path that autocommit sweeps.

## Where it touches (2026-10-20)

- Two duplicate `BOX_MARKER` constants: `beebox/src/lib/paths/core.ts:57` and
  `beebox/src/lib/box-shape.ts:34`, each with its own minimum-version logic.
  Collapse them.
- Predicates: `isValidBox` and the marker reads in
  `beebox/src/core/box/structure/core.ts`, `detectBoxTarget` in
  `beebox/src/core/box/package.ts`, `isBox` in
  `beebox/src/core/schedule/scheduler/core.ts`.
- Other engine readers: `beebox/src/cli/commands/boxes.ts`,
  `beebox/src/cli/commands/scheduler/command.ts`, `beebox/src/hub/config.ts`,
  `beebox/src/lib/box-shape-errors.ts`, and the dev tools
  `beebox/src/dev/lib/audit-box.ts` and
  `beebox/src/dev/lib/context-assembly/assembly.ts`. Comments that name the
  marker: `beebox/src/schemas.ts`, `beebox/src/core/maps/precheck-ignore.ts`,
  `beebox/src/dev/knowledge-audit.ts`.
- Outside the engine: `workstreams-app/src/router/box-entry.ts` (branches on
  `shapeVersion === 2` for slug derivation),
  `schedules/cross-box-leak-scan/box-manifest.ts`, `bin/lib/worktree-create.sh`
  (the copy workaround, removable after), `beebox/deploy/add-box.sh`,
  `beebox/deploy/hetzner/setup-server.sh` (tests for the marker before
  initializing and committing a box), `beebox/docker/entrypoint.sh`,
  `beebox/docker/smoke-docker.sh`.
- About 30 tests write markers by hand, many through
  `beebox/test/helpers/test-helpers.ts`.

Verification must include a fresh `git clone` of a box being recognized as a
box, as well as unit tests.

> 2026-10-20 (bug-burndown-4): implemented on the worktree branch, not yet
> merged; plan `beebox/docs/implemented-plans/box-shape-in-package-json.md`. When closing:
> clone recognition holds only once the SOURCE box has run
> `box-shape-record-2026-10` and committed it (production through the deploy
> sweep, local boxes through `bbx engine migrate --sweep`). A clone made
> before that gets `MissingShapeRecordError` with a recovery line. The marker
> fallback and its removal are tracked in
> `issues/deferred/2026-10-20-drop-box-marker-fallback.md`.
