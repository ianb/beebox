---
title: "Box identity and shape version from tracked package.json"
status: implemented
workstream: bug-burndown-4
issues:
  - ../../../issues/closed/bugs/2026-10-20-box-marker-in-gitignored-state-dir.md
---
# Box identity and shape version from tracked package.json

Today the engine recognizes a box by `.beebox/box.json`. That file is in the
gitignored state directory, so a `git clone` of a box is not a box. This plan
implements "The marker decision, 2026-09-13" in
`issues/closed/bugs/2026-09-03-rename-left-old-gitignore-boxes-commit-state-dir.md`.
Identity comes from tracked files. The shape version moves to a `beebox`
block in the box `package.json`.

**Issues addressed:** `issues/bugs/2026-10-20-box-marker-in-gitignored-state-dir.md`.
A search of `issues/` for `marker`, `box.json`, and `clone` found no other open
item. This change removes the cause of the closed
`2026-10-09-knowledge-audit-refuses-fresh-worktree-box-clone.md`.

## Design

No design section: this is box-discovery infrastructure. The only visible
change is that the dashboard footer no longer shows "v1.0.0".

## Smallest fix and budget

Smallest fix: `isValidBox` accepts "package.json declares beebox and
`_config/` exists". With only that change, `getBoxShape` still needs the
marker for `shapeVersion`, so a clone fails one step later. The decided shape
needs tracks A–E. Estimate: about 330 changed source lines, about 450 test
lines (mostly fixture conversion), about 60 doc lines. This is not a BIG CHANGE.

## Stated preferences this plan trades against

`docs/engineering-principles.md` §8 (one way): two `BOX_MARKER` constants and
two minimum-version constants become one reader. §3 (validate at boundaries):
zod parses the block. §4 (never silent): identity without a shape record is a
named error with a recovery line, never an inferred version. The decision
rejected a `package.json` write in `migrateBoxState`; only the fresh scaffold
and the listed migration write the block.

## What already exists

- `src/lib/box-shape.ts:34` `BOX_MARKER`, `:37-40` MIN/MAX 3, `:50`
  `z.object({ shapeVersion: z.number().optional() })` (drops `created`).
  `getBoxShape` (`:75`): `migrateBoxState`, marker, v2 probe (`:89-90`),
  `requireBeeBoxDependency` (`:207-228`, reused).
- `src/lib/paths/core.ts:57` duplicate `BOX_MARKER`, `:97`
  `MIN_ACCEPTED_SHAPE_VERSION`. `findBoxRoot` (`:120-143`) finds the marker or
  the legacy marker (`:124-127`); `requireBoxRoot` (`:160-161`) then migrates
  legacy state. `bbx migrate` discovers through `findBoxRoot`
  (`cli/commands/migrate.ts:237`).
- `src/core/box/structure/core.ts:37` `z.object({ version: z.string(), created:
  z.string() })`; `:109-115` fresh init writes the marker; `:131` seed-failure
  rollback; `:323` `isValidBox`; `:341` `getBoxMetadata`. `getSystemState`
  throws `InvalidBoxError` without metadata (`core/state.ts:134-137`), so a box whose
  dashboard or `bbx status` works has `created`. The test box clone's marker:
  `version`, `created`, `shapeVersion: 3`, `migrated-at`.
- `src/core/box/package.ts:89` `detectBoxTarget`; `:206-210` the "already has
  a package.json" refusal a clone hits; `:215` the scaffold literal.
- `scheduler/core.ts:48` `isBox`; callers `cli/commands/boxes.ts:30,67`,
  `scheduler/command.ts:68,102,114`.
- `version` path: `core/state.ts:150` → `webapp/trpc/routers/status.ts:182` →
  `SystemInfo.tsx:23` `<span>v{status.boxVersion}</span>`;
  `cli/commands/status.ts:32`. No reader in `ios-app/` or `beebox-clerk/`.
- Migration precedent: `src/core/migrations.ts:146` `retire-memo-2026-10`
  (`run.ts` + `plan.ts`, tests in `test/scripts/migrate/`); retired
  `gitignore-2026-09` used `git rm --cached`. New boxes seed every listed
  migration as applied (`structure/core.ts:17`).
- `test/helpers/test-helpers.ts:71` `makeTmpBox` goes through `scaffoldBoxRoot`.
- Deploy's dependency rewrite (`deploy/deploy.sh:734-741`) reserializes
  `package.json`, so it keeps the block. Nothing keeps that rewrite out of box
  history: agent turns commit with `stageAll` (`lib/git/core/operations.ts:278-281`,
  `add -A`; `core/agent/invoke/commit.ts:88`), and `defaultBeeBoxSpec`
  (`package.ts:56-58`) scaffolds a machine-local `link:` spec by design (the
  test box clone's HEAD carries one, commit `2a4533e2`). A migration commit of
  the whole file adds no exposure.
- Readers the issue missed: `docs/box-layout.md:9,45,55,73,144,229`,
  `README.md:46`, `dev/lib/context-assembly/assembly.ts:119`.

## Prior art (external)

No design decision depends on an external premise. npm and pnpm ignore
unknown top-level `package.json` keys.

## Ontology

- **Box identity**, `isBoxRoot(dir)`: `package.json` declares `beebox` or
  `LEGACY_PACKAGE_NAME`, AND `_config/` (v3) or `content/config/` (v2) exists.
- **Shape record**, `readShapeRecord(dir)` → `{ shapeVersion, created, source:
  "package" | "marker" }`; block first, then marker; no writes.
- **`beebox` block**: `{ "shapeVersion": 3, "created": "<ISO>" }`, zod
  `z.object({ shapeVersion: z.number().int(), created: z.string() })`.
  `created` is required: `getSystemState` refuses a marker without it, and
  the test box clone's marker has it. Unverified against production markers;
  the migration's exit 1 on a missing value is the recovery signal.
- **Marker**: read-only transition fallback; its parse now keeps `created`.
- **v2 probe**, `refuseV2(dir)`: no `_config/`, and `content/config/` or
  `content/.beebox/box.json` → `V2PackageRootError`.
- `version` leaves every type; `BoxShape` (`box-shape.ts:42`) is unchanged.

## Tracks / scope

### A. One reader, one identity predicate (`src/lib/box-shape.ts`)

Why: two resolvers keep separate minimum-version constants in lockstep.

- `isBoxRoot`: `false` without a sibling, without `package.json`, or without
  the dependency; throws `UnreadablePackageJsonError` when a sibling exists
  and `package.json` does not parse. Stats the sibling first.
- `readShapeRecord`: block, then marker; neither → new
  `MissingShapeRecordError`, whose message gives the block's form and the
  recovery ("run `bbx engine migrate` in the source box and commit, then pull;
  or copy its `.beebox/box.json` here"). `< 3` → `PreV3ShapeError`; `> 3` →
  `NewerShapeRequiredError`.
- `probeBox(dir)`, shared by `getBoxShape` and `findBoxRoot`: `refuseV2`, then
  `readShapeRecord`.
- `getBoxShape`: `migrateBoxState` → `refuseV2` → no sibling: `NotABoxError` →
  `requireBeeBoxDependency` → `readShapeRecord`. `getBoxShapeIfPresent`
  returns `found: false` on `NotABoxError` (`box-shape.ts:138` is the only
  ENOENT reliance among `getBoxShape(` callers).
- `findBoxRoot`, per level: a legacy marker (not a state dir alone) returns
  the root as today (`:124-127`), so `requireBoxRoot` still reaches
  `migrateBoxState`; otherwise `isBoxRoot` or a v2 sibling → `probeBox`. From
  inside a v2 `content/`, the walk reaches the package root and throws
  `V2PackageRootError`.
- `isValidBox`, scheduler `isBox`, `detectBoxTarget` call `isBoxRoot`.
- Lock-ins: `isBoxRoot`, `readShapeRecord`, `MissingShapeRecordError`, block keys.

### B. `bbx init` writes the block

`initBox`'s fresh path (`structure/core.ts:109-115`) writes the block with
`writeShapeBlock` (the pure `setShapeBlock` in `box-identity.ts`, shared with
the migration) and creates `_config/` before the fail-fast `getBoxShape`
(`:124`). A failed seed removes the block (`:131`), so a retry is fresh again.
Fresh or update is decided by the shape record (`recordedShapeSource`), not by
identity: a repo with commits but no record (a clone of an unmigrated box) is
refused with `MissingShapeRecordError`. `detectBoxTarget` uses identity, so a
clone takes the update path.

*Implementation (2026-10-20):* the plan put the block in `scaffoldPackageRoot`
and keyed `isUpdate` on identity. That broke fresh-init retry: identity holds
as soon as `_config/` exists, and removing `_config/` on rollback would delete
authored notes (`migration-run.canonical-interface-cards.test.ts`). Fresh init
also still writes the marker, in the shape older engines read (`version`,
`created`), because a box's git hooks can run an older checkout's `bbx`
(`resolveStableCheckoutBbx`), and that engine needs the marker; the same
write keeps a box made after deploy openable on rollback.

### C. Drop `version`

Delete `getBoxMetadata`; `getSystemState` takes `created` from
`readShapeRecord`. Remove `SystemState.boxVersion`, `status.ts:182`'s field,
`SystemInfo.tsx:23`'s `v{…}` span, and `cli/commands/status.ts:32`. The
"Created" date stays.

### D. Listed migration `box-shape-record-2026-10`

`src/scripts/migrate/box-shape-record/plan.ts` (pure: package.json text +
marker text → new package.json text or a refusal) and `run.ts`; entry after
`retire-memo-2026-10`; test `test/scripts/migrate/box-shape-record.test.ts`.

1. Valid block present → no write. Else set `pkg.beebox = { shapeVersion,
   created }` from the marker; write `JSON.stringify(pkg, null, 2) + "\n"`.
2. Leave the marker file on disk (boxholder decision, 2026-10-20), so a
   rollback to an older engine still opens the box during the transition.
3. Verify `readShapeRecord(...).source === "package"`.

Exit 1 with nothing written when there is neither block nor marker, or the
marker's `shapeVersion` is not 3, or it lacks `created`. No exit-2 case.

*Implementation (2026-10-20):* the decided `git rm --cached` is not done here.
The sweep commits the paths whose working-tree content changed
(`changedMigrationPaths`, `migration-recovery.ts:91`), and an untrack that
keeps the file on disk changes no content, so the removal would stay staged
and land in the next unrelated agent commit. The marker stays tracked where it
was; the deferred cleanup deletes the file, which the sweep does commit,
untracking it in the same commit. Same
commit: `issues/deferred/2026-10-20-drop-box-marker-fallback.md`
(`activate-on: 2026-11-20`, `category: code-quality`) naming the marker branch
of `readShapeRecord`, the marker clause of `refuseV2`, and
`bin/lib/worktree-create.sh:335-337`, and adds a listed migration that deletes
the now-unused `.beebox/box.json`; trigger: every local and production box
lists `box-shape-record-2026-10` in `_config/migrations.jsonl`.

### E. Readers outside the engine, text, docs

- `schedules/cross-box-leak-scan/box-manifest.ts:41-44` resolves a markerless
  root to `<path>/content`, wrong after the migration. New rule, still
  dependency-free (`:1-6`): `_config/` at the root → root, else `content`.
- `workstreams-app/src/router/box-entry.ts`: no change; a migrated box reaches
  the fallback at `:117` with the right root and slug. Add that case to
  `workstreams-app/test/router/box-entry.test.ts`.
- `deploy/add-box.sh:379-385`: test `$BOX_PATH/_config`; drop the v2 branch.
- `deploy/hetzner/setup-server.sh:214`: skip init only when `git -C
  "$BOX_DIR" rev-parse HEAD` succeeds and `_config/` and `package.json` exist,
  so a partial init (no commit) is redone.
- `docker/entrypoint.sh:46` → `[[ -d "$BOX_ROOT/_config" ]]` (package.json and
  HEAD checks already there). `docker/smoke-docker.sh:104`: assert
  `.beebox.shapeVersion` via `node -e`, and no marker.
- Text naming the marker: `cli/commands/boxes.ts:31,68`,
  `scheduler/command.ts:69,103`, `scheduler/core.ts:46,191`,
  `box-shape-errors.ts:41,67`, `dev/lib/context-assembly/assembly.ts:119`,
  `schemas.ts:255`, `maps/precheck-ignore.ts:165`, `dev/knowledge-audit.ts:203`,
  `dev/lib/audit-box.ts:15`, `hub/config.ts:149`, `core/box/package.ts:80,283`.
- `bin/lib/worktree-create.sh:330-339`: keep the `cp`; its comment names the
  deferred issue.
- Docs: `docs/box-layout.md` and `README.md:46` (box anatomy).

## Could this be simpler?

Track A's predicate alone, with the marker still required for the version,
fails the reported case: `getBoxShape` on a clone still finds no marker (§4).
Inferring `shapeVersion: 3` from `_config/` would drop the fallback, but it
reverses the decision that the version is recorded, and it would read a v4
box that lost its block as v3. Staging the HEAD blob so the deploy rewrite
stays out of the migration commit (raised in review) is rejected: nothing
keeps that rewrite out of history today (What already exists), and the sweep
stages working files (`migration-sweep.ts:259`), so it would need new sweep
machinery against a leak the next agent commit restores.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Clone of an unmigrated box: no block, no marker | new: clone test | `MissingShapeRecordError` with recovery; `cp` in worktree-create | clear |
| `bbx migrate` from inside a v2 `content/` | new: paths test | `refuseV2` in `findBoxRoot` | clear |
| Legacy marker only | existing `state-migration.test.ts`, extended | legacy discovery kept | clear |
| Block malformed (`shapeVersion: "3"`) | new | zod → `BoxShapeError` | clear |
| Block and marker disagree | new | block wins; the marker is unread once a block exists | clear by rule |
| A broken `package.json` beside `_config/` above a box path | new: paths test | `UnreadablePackageJsonError` | clear |
| Setup rerun after a partial init | none (no setup harness) | HEAD gate | clear |
| Deploy rollback to an engine from before this change, after the migration | migration test asserts the marker stays | marker kept on disk until the deferred cleanup | clear |
| Leak scan resolves a migrated box to `<path>/content` | new: host-audit test | track E | was silent; fixed |

> **Rollout prerequisite:** clone recognition holds only for a clone of a
> box that has run `box-shape-record-2026-10` and committed it. The deploy
> sweep migrates production boxes; a local box must run `bbx engine migrate`
> before it is cloned. Before that, a clone gets `MissingShapeRecordError`
> with its recovery line, and the worktree `cp` covers worktree clones.

## Agent-flow / user-flow edge cases

- Wrong file (`_config/box.json` edited for the shape): ADDRESSED, the block is
  in `package.json` and `docs/box-layout.md` says so.
- Hand-edit drift (block deleted): ADDRESSED, the error names its exact form.
- Partial migration (block written, sweep commit failed): ADDRESSED, the
  block wins on read and the sweep retries the commit.
- Mixed fleet: each engine reads block or marker. Cards, tags, concurrent
  agents: not applicable.

## NOT in scope

- Removing the marker fallback and the worktree `cp`: the deferred issue does this.
- Retiring `LEGACY_BOX_MARKER` handling: separate legacy cleanup; discovery keeps it.
- Keeping deploy's server-local `link:` dependency out of box history: this
  predates the change, and agent commits already include it. Filed as
  `issues/bugs/2026-10-20-deploy-beebox-link-reaches-box-history.md`.
- Showing the shape version on the dashboard: nobody asked for it.

## Open design questions

None. The code does not contradict the decided shape.

## Knowledge audits

Skip: this is infrastructure. A grep of `src/core/agent-guide/` found no
mention of the marker in the box agent guide.

## What will hold this after it ships

- Unit tests for `isBoxRoot`, `readShapeRecord`, `refuseV2`, and `findBoxRoot`:
  each predicate branch, each step of the chain, the v2 `content/` start, the
  legacy marker, and `created` read from the marker.
- `test/core/box/clone-is-a-box.test.ts`: `makeTmpBox({ git: true })`, `git
  clone`; the clone has no marker; `isValidBox`/`isBox` true; `getBoxShape`
  returns 3; `findBoxRoot(<clone>/_content)` is the clone; `detectBoxTarget`
  is `"update"`; `runInit` completes. Second case: a pre-migration box (marker,
  no block) cloned gets `MissingShapeRecordError` with the recovery line.
- The migration test: the decision cases; the runner on a box with the
  marker only (block written, marker kept, rerun "already converted", clone
  is a box); and the real sweep on a box that tracks its marker (commit holds
  `package.json` and the manifest, tree clean, marker still tracked).
- Fixtures: `writeBoxFiles` and `useMarkerOnly` in `test/helpers/test-helpers.ts`.
  *Implementation:* the hand-written marker fixtures now write `_config/` and
  the block (`writeBoxFiles`), because a valid marker alone no longer makes a
  box (identity is required on the marker path too; a marker that is not
  shape 3 is still diagnosed). Tests that seeded markers for the dashboard's
  `version`/`created` lost the seed; tests that provoke a bad shape write it
  through `useMarkerOnly`.

## Implementation order

1. Track A and the fixture helper (`initBox` still writes the marker).
2. Tracks B and C together (dropping `getBoxMetadata` had to land with the
   block) and the clone tests. 3. Track D and the deferred issue.
5. Track E with the router regression test.
6. On the worktree's box clone: `bbx engine migrate --box
   ~/src/box-worktrees/bug-burndown-4/test1`, commit, `git clone` it into the
   scratchpad, `bbx engine init <clone>`; confirm the committed `package.json`
   diff is only the block. Then change-selected tests and typecheck.

## Rollout shape

**Prerequisite:** a clone is recognized only when its source box has run
`box-shape-record-2026-10` and committed it. Production boxes migrate in the
deploy sweep; a local box must run `bbx engine migrate --sweep` before anyone
relies on cloning it (the worktree's `test1` clone did, commit `c1bf7fc5`).
Until then a clone gets `MissingShapeRecordError` with its recovery line.

Done when the unit, clone, migration, and router tests pass, and the
change-selected suite passes. The migration is scripted and atomic per box
(one sweep commit). Production converges on the next deploy sweep. No
knowledge audits land.
