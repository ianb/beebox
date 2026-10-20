---
title: "Box identity and shape version from tracked package.json"
status: draft
workstream: bug-burndown-4
issues:
  - ../../../issues/bugs/2026-10-20-box-marker-in-gitignored-state-dir.md
---
# Box identity and shape version from tracked package.json

A box is recognized today by `.beebox/box.json`, which lives in the gitignored
state directory, so a `git clone` of a box is not a box. This plan implements
the decision recorded in "The marker decision, 2026-09-13" of
`issues/closed/bugs/2026-09-03-rename-left-old-gitignore-boxes-commit-state-dir.md`:
identity comes from tracked files, and the shape version moves to a `beebox`
block in the box's `package.json`.

**Issues addressed:** `issues/bugs/2026-10-20-box-marker-in-gitignored-state-dir.md`.
Searched `issues/` for `marker`, `box.json`, `clone`: no other open item. The
closed `2026-10-09-knowledge-audit-refuses-fresh-worktree-box-clone.md` is the
symptom this removes.

## Design

No design section: the change is box-discovery infrastructure. The only
visible change is that the dashboard footer stops showing "v1.0.0".

## Smallest fix and budget

Smallest fix: make `isValidBox` accept "package.json declares beebox and
`_config/` exists". That fixes `bbx init` on a clone, but `getBoxShape` still
needs the marker for `shapeVersion`, so the clone still fails one step later.
The decided shape needs all five tracks below. Estimate: source about 350
changed lines, tests about 450 (most of it mechanical fixture conversion),
docs about 60. Not a BIG CHANGE.

## Stated preferences this plan trades against

- `docs/engineering-principles.md` §8 "One way to do each thing": two
  `BOX_MARKER` constants and two minimum-version constants collapse to one
  reader in `src/lib/box-shape.ts`.
- §3 "Validate at boundaries": the `beebox` block is parsed with zod; a
  malformed block is a `BoxShapeError`, never a guess.
- §4 "never silent": a box with identity but no shape record gets a named
  error, not "not a box".
- The decision rejected writing `package.json` from `migrateBoxState`; this
  plan writes it only in `bbx init` (fresh scaffold) and the listed migration.

## What already exists

- `src/lib/box-shape.ts:34` `const BOX_MARKER = ".beebox/box.json";` and
  `:37-40` MIN/MAX 3. `getBoxShape` (`:75`) runs `migrateBoxState`, reads the
  marker, probes `content/` for a v2 marker (`:89-90`), then
  `requireBeeBoxDependency` (`:207-228`) — the dependency check, reused as is.
- `src/lib/paths/core.ts:57` `export const BOX_MARKER = ".beebox/box.json";`,
  `:77` `markerShapeVersion`, `:97` `MIN_ACCEPTED_SHAPE_VERSION = 3`;
  `findBoxRoot` (`:120-143`) walks up looking for the marker. Rebuilt on the
  box-shape.ts reader.
- `src/core/box/structure/core.ts:323` `isValidBox` (`fs.access` of the
  marker); `:109-115` fresh-init writes `{ version: "1.0.0", shapeVersion: 3,
  created }`; `:131` rolls the marker back on a failed seed; `:341`
  `getBoxMetadata` reads `version`/`created`.
- `src/core/box/package.ts:89` `detectBoxTarget` calls `isValidBox`;
  `:197-210` `scaffoldPackageRoot` writes `package.json` and refuses an
  existing one ("it already has a package.json") — the clone failure.
- `src/core/schedule/scheduler/core.ts:48` `isBox` (`fs.access` of
  `BOX_MARKER`), `:191` log line naming the marker. Callers:
  `src/cli/commands/boxes.ts:30,67`, `src/cli/commands/scheduler/command.ts:68,102,114`.
- `src/core/state.ts:134,150` `boxVersion: metadata.version` →
  `src/webapp/trpc/routers/status.ts:182` → `SystemInfo.tsx:23`
  `<span>v{status.boxVersion}</span>`; `src/cli/commands/status.ts:32`
  prints `Version:`.
- `src/lib/box-shape-errors.ts:35-49` `PreV3ShapeError`, `:51`
  `NewerShapeRequiredError` (kept), `:63-71` `NotABoxError` text names the marker.
- Listed-migration precedent: `src/core/migrations.ts:146` `{ name:
  "retire-memo-2026-10", script: "src/scripts/migrate/retire-memo/run.ts" }`,
  directory `run.ts` + `plan.ts`, tests in `test/scripts/migrate/`. The
  retired `gitignore-2026-09` (`git show 81c647230^:beebox/src/scripts/migrate/box-gitignore.ts`)
  is the `git rm --cached` precedent. The sweep commits with `git add -A`
  (`src/core/migration-recovery.ts:70`).
- A fresh box's manifest is seeded with every listed migration applied
  (`structure/core.ts:17` imports `MIGRATIONS`), so new boxes skip the new one.
- `test/helpers/test-helpers.ts:71` `makeTmpBox` calls `scaffoldBoxRoot`; it
  needs no change once the scaffold writes the block.

Readers the issue did not list (grep of `beebox/`, `bin/`, `workstreams-app/`,
`schedules/` for `box.json`, `BOX_MARKER`, `shapeVersion`): `docs/box-layout.md:9,45,55,73,144,229`
and `src/dev/lib/context-assembly/assembly.ts:119` (error text). `deploy/deploy.sh:727`,
cited in the closed issue, only reads `package.json` and is unaffected.
`src/lib/state-migration.ts:119-120` moves the pre-rename marker (`LEGACY_BOX_MARKER`) to `.beebox/box.json`;
it keeps feeding the marker fallback and is unchanged.

## Prior art (external)

No design decision depends on an external premise. npm and pnpm ignore
unknown top-level `package.json` keys; the deploy rewrite at
`deploy/deploy.sh:734-740` parses and reserializes, so it keeps the block.

## Ontology

- **Box identity** (new predicate `isBoxRoot(dir)` in `src/lib/box-shape.ts`):
  `package.json` declares `beebox` or `LEGACY_PACKAGE_NAME` in
  `dependencies`/`devDependencies`, AND a structural sibling exists:
  `_config/` (v3) or `content/config/` (v2). Not the shape version.
- **Shape record** (new `readShapeRecord(dir)`): `{ shapeVersion, created?,
  source: "package" | "marker" }`. Read in order: `package.json` `beebox`
  block → `.beebox/box.json` → none. Does not migrate state or write.
- **`beebox` block**: `"beebox": { "shapeVersion": 3, "created": "<ISO>" }` in
  the box `package.json`. `created` is optional (a marker without it migrates
  without it). Zod: `z.object({ shapeVersion: z.number().int(), created: z.string().optional() })`.
- **Marker** (`.beebox/box.json`): read-only fallback during the transition.
- **v2 probe**: the existing `content/` check in `getBoxShape`, widened to
  `content/config/` or `content/.beebox/box.json` → `V2PackageRootError`.
- `version` is removed from every type. `BoxShape` (`box-shape.ts:42`) is unchanged.

## Tracks / scope

### A. One reader, one identity predicate (`src/lib/box-shape.ts`)

- **What:** move every marker read into box-shape.ts; delete the paths/core.ts copies.
- **Why:** two resolvers with separate minimum-version constants must change in lockstep.
- **Direction:**
  - `isBoxRoot(dir): Promise<boolean>`: `false` when neither sibling exists
    or `package.json` is absent or lacks the dependency. Throws
    `UnreadablePackageJsonError` when a sibling exists and `package.json` does
    not parse. Stats the sibling before reading `package.json`, so the
    `findBoxRoot` walk costs one `stat` per non-box level.
  - `readShapeRecord(dir)`: block → marker (the current `readBoxMarker`
    parse, empty file = no `shapeVersion`) → throws new
    `MissingShapeRecordError` ("has a beebox package.json and `_config/` but no
    `beebox.shapeVersion` in package.json and no `.beebox/box.json`").
    Range check: `< 3` → `PreV3ShapeError`, `> 3` → `NewerShapeRequiredError`.
  - `getBoxShape`: `migrateBoxState` → v2 probe (only when `_config/` is
    absent) → no sibling: `NotABoxError` → `requireBeeBoxDependency` →
    `readShapeRecord`. `getBoxShapeIfPresent` returns `found: false` on
    `NotABoxError` instead of raw ENOENT (`box-shape.ts:138` is the only
    ENOENT reliance; grep of `getBoxShape(` callers found no other).
  - `findBoxRoot` (`paths/core.ts:120`): at each level `if (await isBoxRoot(current)) { await readShapeRecord(current); return current; }`.
    The `LEGACY_BOX_MARKER` check goes; `requireBoxRoot`'s `migrateBoxState`
    call (`:160-161`) stays.
  - `isValidBox`, scheduler `isBox`, `detectBoxTarget` call `isBoxRoot`.
    `isBox` stays exported as a thin alias for its CLI callers.
- **Vocabulary lock-ins:** `isBoxRoot`, `readShapeRecord`, `MissingShapeRecordError`, the `beebox` block keys.
- **First chunk:** reader + predicate + errors + unit tests in `test/lib/box-shape.test.ts` and `test/lib/paths.test.ts`; marker still written by `initBox`.

### B. `bbx init` writes the block

- `scaffoldPackageRoot` (`package.ts:215`, `const packageJson = {`) adds `beebox: { shapeVersion: 3,
  created: getBoxTimeISO(boxRoot) }` to the literal it writes.
- `initBox` fresh path (`structure/core.ts:109-115`) stops writing the marker.
  It creates `_config/` before the `getBoxShape` fail-fast check (`:124`),
  because identity now needs it; the seed-failure rollback (`:131`) removes
  the `_config/` this call created instead of the marker.
- `isUpdate` is `isBoxRoot`, so `bbx init` on a clone takes the update path
  and no longer reaches the "already has a package.json" refusal.

### C. Drop `version`

- `getBoxMetadata` is deleted; `getSystemState` reads `created` from
  `readShapeRecord`. `SystemState.boxVersion` is removed;
  `SystemState.created` becomes `string | undefined`.
- `status.ts:182` drops `boxVersion`; `SystemInfo.tsx:23` drops the
  `v{…}` span and renders "Created" only when present; `cli/commands/status.ts:32`
  drops the `Version:` line. The footer keeps created date, git state, and
  deploy hash, which already identify the build. No iOS or clerk reader
  (grep of `ios-app/`, `beebox-clerk/` for `boxVersion`: none).

### D. Listed migration `box-shape-record-2026-10`

- Files: `src/scripts/migrate/box-shape-record/plan.ts` (pure: package.json
  text + marker text or null → new package.json text, or a refusal) and
  `run.ts`; entry appended to `MIGRATIONS` after `retire-memo-2026-10`; test
  `test/scripts/migrate/box-shape-record.test.ts`.
- Steps: (1) block present and valid → no write; else parse the marker and
  write `pkg.beebox = { shapeVersion, created? }` with
  `JSON.stringify(pkg, null, 2) + "\n"`. (2) `git ls-files --error-unmatch
  .beebox/box.json` succeeds → `git rm --cached --quiet -- .beebox/box.json`.
  (3) `fs.rm` the marker (ENOENT is fine). (4) Verify `readShapeRecord(...).source === "package"`.
- Exit 1 with nothing written when neither block nor marker exists or the
  marker's `shapeVersion` is not 3 (unreachable through `bbx engine migrate`,
  which resolves the box first). No exit-2 case: nothing is left for an agent.
- Same commit: a deferred issue
  `issues/deferred/2026-10-20-drop-box-marker-fallback.md`
  (`activate-on: 2026-11-20`, `category: code-quality`) naming the marker
  branch of `readShapeRecord`, the v2 probe's marker check, and the `cp` in
  `bin/lib/worktree-create.sh:335-337`; trigger: every local and production
  box lists `box-shape-record-2026-10` in `_config/migrations.jsonl`.

### E. Readers outside the engine, comments, docs

- `schedules/cross-box-leak-scan/box-manifest.ts:41-44`: today a root without
  the marker resolves to `<path>/content` — wrong after the migration. New
  rule (dependency-free, per `:1-6`): `_config/` at the root → root; else
  `content`.
- `workstreams-app/src/router/box-entry.ts:92` (`resolveBoxEntry`): a `package.json` `beebox`
  block first → `{ contentDir: resolved, slug: basename }`; existing branches
  stay. A migrated box already reaches the right answer through the fallback
  at `:117`; the block check makes it explicit.
- Shell: `deploy/add-box.sh:379-385` → `_config/` at `$BOX_PATH` (drop the v2
  branch; v2 cannot open); `deploy/hetzner/setup-server.sh:214` →
  `[[ ! -d _config ]]`; `docker/entrypoint.sh:46` → `[[ -d "$BOX_ROOT/_config" ]]`;
  `docker/smoke-docker.sh:104` → assert `package.json` has `.beebox.shapeVersion`
  via `node -e`, and assert no marker.
- Message and comment text: `cli/commands/boxes.ts:31,68`,
  `scheduler/command.ts:69,103`, `scheduler/core.ts:46,191`,
  `box-shape-errors.ts:41,67`, `dev/lib/context-assembly/assembly.ts:119`,
  `schemas.ts:255`, `maps/precheck-ignore.ts:165`, `dev/knowledge-audit.ts:203`,
  `dev/lib/audit-box.ts:15`, `hub/config.ts:149`, `core/box/package.ts:80,283`.
- `bin/lib/worktree-create.sh:330-339`: keep the `cp`; it covers clones of a
  source box that has not migrated yet. Update the comment to name the
  deferred issue.
- `docs/box-layout.md`: identity and the block replace the marker text.
  `deploy/README.md` gets the rollback recovery line (Failure modes).

## Could this be simpler?

The simplest version is Track A's predicate alone with the marker still
required for the version; it fails on the reported case, because
`getBoxShape` on a clone still finds no marker (§4: the clone would get a
different error, not a box). Inferring `shapeVersion: 3` from `_config/` would
drop the fallback chain and the migration's urgency, but it reverses the
decision that the version is recorded, not guessed, and it would read a future
v4 box with a missing block as v3. Track E's box-entry change is optional and
costs about 10 lines; it is kept so the router does not depend on a fallthrough.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Clone of a box whose source has not migrated: no block, no marker | new: box-shape test | `MissingShapeRecordError`; `cp` in worktree-create | clear |
| `package.json` block malformed (`shapeVersion: "3"`) | new | zod → `BoxShapeError` | clear |
| Block and marker disagree | new | block wins; migration deletes marker | clear by rule |
| Unrelated dir with `_config/` and a broken `package.json` above a box path | new: paths test | `UnreadablePackageJsonError` from the walk | clear |
| Deploy rollback to a pre-change engine after the migration ran: old engine needs the marker | none | none | clear (old engine says "not a box") |
| Migration commit fails | existing sweep tests | `migrate.ts:189` rolls back the manifest entry | clear |
| Leak scan resolves a migrated box to `<path>/content` | new: host-audit test | Track E | was silent; fixed |

> **Accepted risk:** deploy rollback across this change. Recovery is one
> command per box: `node -e` writing `.beebox/box.json` from the block. The
> `deploy/README.md` gets that line (Track E). A rollback across a box migration
> already needs manual care.

## Agent-flow / user-flow edge cases

- Wrong field: an agent edits `_config/box.json` thinking it is the shape
  record. ADDRESSED: the block lives in `package.json`, and `docs/box-layout.md`
  states it.
- Hand-edit drift: a boxholder deletes the block. ADDRESSED: `MissingShapeRecordError`
  names the block and its exact form.
- Partial migration: block written, `git rm --cached` failed. ADDRESSED: the
  block wins on read; rerun is idempotent and completes step 2–3.
- Two agents, stale refs, fabricated values: not applicable; no card or tag.
- Transition state: an engine reads block or marker, so mixed fleets work.

## NOT in scope

- Removing the marker fallback and the worktree `cp`: the deferred issue, after convergence.
- Retiring `LEGACY_BOX_MARKER` handling in `state-migration.ts`: separate legacy cleanup.
- `bin/lib/worktree-create.sh:146` v2 pre-rename marker repair: unrelated legacy.
- Showing the shape version on the dashboard: nobody asked; `version` simply goes.

## Open design questions

None. The code does not contradict the decided shape. Two details the
decision left open are settled above: `created` is optional in the block, and
a box with identity but no record gets `MissingShapeRecordError` rather than
an inferred version.

## Knowledge audits

Skip: infrastructural. No agent-facing concept changes; the box agent guide
does not mention the marker (grep of `src/core/agent-guide/` for `box.json`: none).

## What will hold this after it ships

Unit tests on `isBoxRoot` and `readShapeRecord` (each predicate branch and
each chain step) hold the decision cheaply. One integration test holds the
reported bug: `test/core/box/clone-is-a-box.test.ts` — `makeTmpBox({ git: true })`,
`git clone` it to a second temp dir, then check: no `.beebox/box.json` in the
clone; `isValidBox`, `isBox` true; `getBoxShape` returns `shapeVersion: 3`;
`findBoxRoot(<clone>/_content)` returns the clone; `detectBoxTarget` mode is
`"update"`; `runInit(<clone>)` completes. The migration test builds a box
with a force-tracked marker (`git add -f`) and no block, runs `run.ts --apply`,
asserts the block, `git ls-files` without the marker, the file gone, a second
run reporting "already converted", and then clones it and repeats the clone
checks. Both use real git and git-annex, as `makeTmpBox` already does.

Fixtures: add `writeBoxFiles(root, { shapeVersion?, created?, dependency? })`
to `test/helpers/test-helpers.ts` (package.json with dependency and block,
plus `_config/`). Convert the hand-written marker sites to it (18 `writeFile`
sites; `grep -rn "\.beebox.*box\.json" beebox/test` lists them, e.g.
`test/lib/box-slug.test.ts:21`, `test/core/agent-context-mirrors.test.ts:16`,
`test/core/box-growth/health.test.ts:201`). Tests that exist to exercise the
marker fallback keep writing a marker on purpose: `box-shape.test.ts`,
`paths.test.ts`, `state-migration.test.ts`, the migration test.

## Implementation order

1. Track A plus fixture helper; `initBox` still writes the marker, and
   fixtures without `_config/` are converted in this commit so the suite stays green.
2. Track B; the clone integration test.
3. Track C.
4. Track D with the deferred issue.
5. Track E.
6. Verify on the worktree's box clone: `bbx engine migrate --box
   ~/src/box-worktrees/bug-burndown-4/test1`, commit, `git clone` it into the
   scratchpad, `bbx engine init <clone>`, `bbx status` inside the clone. Then
   change-selected tests and typecheck.

## Rollout shape

Done when: the clone integration test, the migration test, and the new
box-shape/paths unit tests pass, plus the change-selected suite. Migration is
scripted and atomic per box (one commit through the sweep). Production
converges on the next deploy sweep; local boxes on their next `bbx engine
migrate`. No knowledge audits land.
