---
title: "Drive folder sync time moves out of the folder card"
status: draft
workstream: drive-sync-noop-commits
issues:
  - ../../../issues/closed/bugs/2026-10-29-drive-folder-sync-commits-when-only-last-sync-changed.md
---
# Drive folder sync time moves out of the folder card

Every Drive mirror pass writes the current time into the mount's
`.gfolder.card` as `last-sync`, so a pass that found nothing new on Drive still
changes a tracked file and commits it. This plan moves the sync time into the
Drive connector's gitignored state file, makes the card write skip when nothing
else changed, and strips `last-sync` from existing cards with a migration.

**Issues addressed:**
`issues/closed/bugs/2026-10-29-drive-folder-sync-commits-when-only-last-sync-changed.md`.
Searched `issues/` for `last-sync`, `noop commit`, `empty commit`, `Sync Google
Drive`: no other item covers this. The calendar/Gmail question from the
boxholder ("the Google Calendar commit issue") is answered under *What already
exists*.

## Design

No design section: every surface keeps the values it shows today ("mirrored" /
"never synced" badge, "last sync <date>", `bbx drive status` "Last synced").
What changes for a person is that the box history stops filling with commits
for passes that changed nothing.

## Smallest fix and budget

Smallest fix: skip the card write when only `last-sync` differs, and push the
card onto `updated` only when it was written. The card's `last-sync` then
means "last pass that changed the card", while every surface labels it "last
sync". That is a wrong value under a correct label (principle 13, *"A control
shows the state the system is in"*), and the boxholder chose the strict reading
in the handoff: the sync time is not a change.

Chosen design, one track plus a migration:

- Source: `state.ts` (+25), `folder-sync.ts` / `sync-deps.ts` /
  `folder-types.ts` (+15), `card-stamp.ts` (±15), `mount-list.ts` (±10),
  `tracking.ts` (−8), `status-cli.ts` (±12), `gfolder.tsx` (±15),
  `schemas/gfolder.ts` (±10), `folder-convert.ts` comment (±1). About 120 lines.
- Migration `gfolder-last-sync-2026-10`: `run.ts` + `plan.ts`, about 120 lines;
  registry entry +6.
- Tests: about 200 lines changed or added.
- Docs: `docs/connectors/drive.md` about 6 lines.

Total about 450 changed lines. Not a BIG CHANGE.

## Stated preferences this plan trades against

- Principle 13 (`docs/engineering-principles.md:151`, *"A control shows the
  state the system is in, never the one it intends"*): rules out the smallest
  fix's "last change" value under a "last sync" label.
- Principle 8, one way to do each thing (`:95`): the sync time goes in the
  Drive connector's existing transient state, the file that already holds
  per-Drive-ID run state, rather than a new file under `.beebox/`.
- `docs/connectors.md:94`: *"Sidecar `<file>.sync.json` is usually cleaner
  than an inline header (no diff noise in the human-readable file)."* The repo
  already says run timestamps do not belong inline.
- The handoff named `.beebox/` as the home. The existing precedent is
  `_bookkeeping/connectors/google-drive.state.json`
  (`src/connectors/google-drive/state.ts:2-4`, *"the gitignored
  `_bookkeeping/connectors/google-drive.state.json` file plus its serialized,
  delta-merging writer"*). Same intent (gitignored runtime state), existing
  file and locking; this plan uses it.

## What already exists

- `stampGfolderCard` (`src/connectors/google-drive/card-stamp.ts:72-87`) writes
  unconditionally: *"parts.fields["last-sync"] = stamp.lastSync;"* then
  *"await writeCardParts(cardPath, parts);"*.
- `stampGlinkCard` (`card-stamp.ts:101-112`) already compares before writing:
  *"if (JSON.stringify(parts.fields) === before) return false;"*. Reuse that
  shape for the folder card.
- `syncFolderCard` (`folder-sync.ts:68-74`, `:79-80`, `:167-177`) pushes the
  card onto `updated` after every `stampOutcome`, unconditionally:
  *"result.updated.push(relCard);"*. The connector commits when
  `allChanged.length > 0` (`connector.ts:247`). So even a non-writing stamp
  would still produce a "1 updated" commit attempt; both must change.
- Transient state: `DriveTransientState` (`state.ts:20-30`) with `files` keyed
  by Drive ID, merged per key by `mergeDriveState` (`state.ts:93-106`) and
  saved by `commitDriveStateDelta` (`state.ts:125-141`). Both the connector
  (`connector.ts:237-241`) and `mirrorFolderOnce` (`mount-sync.ts:69`) already
  call it after a folder pass. Reuse: add a `folders` map with the same
  per-key merge.
- `createFolderSyncDeps` (`sync-deps.ts`) receives `state` and builds closures
  over it (`forgetDriveTrash`). Add `recordFolderSync` the same way.
- Readers of `last-sync`: `mount-list.ts:113` (settings mount row via the
  `drive.mounts` tRPC query, `routers/drive.ts:107-110`), `tracking.ts:274`
  (`driveCardSummary`, used by `status-cli.ts:39,85`), `gfolder.tsx:72` (reads
  card frontmatter directly). `DriveMountRow.tsx:163-173` reads
  `mount.lastSync` from the mounts query and needs no change.
- `stageAndCommitPaths` (`src/lib/git/core/operations.ts:374-393`) commits
  nothing when no named path differs: *"const changed = await
  changedFiles(boxRoot, paths); if (changed.length === 0) return null;"*. So
  `syncFolderMount` passing an unchanged card (`mount-sync.ts:117-121`) makes no
  commit, and the unconditional `updated.push(relCard)` only inflates the count
  in a commit that other changes caused. The card's bytes are the whole bug.
- Prod migrations run as the box owner (`deploy/deploy.sh:1277`, *"sudo -u
  "$owner" -H bash -lc ... engine migrate --sweep --repair --json"*), so a
  migration that writes the state file leaves it owned by the box user.

### Calendar and Gmail

Neither commits on a pass that changed nothing upstream, so this plan files no
issue for them.

- Calendar always names two tracked files in its commit
  (`src/connectors/google-calendar/connector.ts:275-280`, the committed state
  and `_config/connectors/google-calendar.json`) and rewrites both each pass.
  Their content holds no run time: the state keeps `eventFiles` with Google's
  `event.updated` and writes `syncTokens` as `{}` (tokens live in transient
  state), and the config holds sorted calendar names and roles. Identical
  bytes leave no diff, and the gate above returns before the
  *"Sync calendar: no changes (token refreshed)"* message is ever committed.
- Gmail returns early when nothing was written (`gmail/connector.ts`
  `commitInbound`: *"if (paths.length === 0) return;"*), and `writeThreadCard`
  compares before writing (*"if (existing === content) return false;"*). The
  cursor lives in transient state.
- No other connectors exist in `src/connectors/`.

## Prior art (external)

No decision depends on an external premise; no search made.

## Ontology

- **Mount card** (existing): a `.gfolder.card`, identified by its `drive.id`
  (`tracking.ts`, duplicates dropped from `liveCards`). Holds what Drive said
  (`title`, `drive.link`), `error`, and the problem counts. After this plan it
  no longer holds a time.
- **Folder sync record** (new): `DriveTransientState.folders[driveId] =
  { lastSync: string }`. When the box last ran a mirror pass over that Drive
  folder, successful or not. Keyed by Drive ID, the same key as `files`, so a
  `bbx mv` of the mount card keeps it. It is not "last change" and not "last
  success" (a failed pass also records it, as `last-sync` does today:
  `folder-sync.ts:79`).
- `FolderMountSummary.lastSync` and the `--json` `lastSync` keep their names
  and meaning; only their source moves.

## Tracks / scope

### Track 1 — sync time in state, card write only on change

- **What:** record the pass time in `state.folders`, drop it from the card
  write, and report the card as updated only when its bytes changed.
- **Why:** each no-op pass rewrites one tracked line and commits it.
- **Direction:**
  - `state.ts`: `folders: Record<string, FolderSyncRecord>` with
    `interface FolderSyncRecord { lastSync: string }`; `normalizeDriveState`
    defaults it to `{}`; `mergeDriveState` merges it per key the same way as
    `files` (writer's changed value wins, fresh keys kept, no deletions).
  - `FolderSyncDeps.recordFolderSync(driveId: string, at: string): void`
    built in `createFolderSyncDeps` over `state`.
  - `FolderStamp` loses `lastSync`; `stampGfolderCard` returns `boolean`
    (written) by comparing serialized fields, like `stampGlinkCard`.
  - `stampOutcome` stamps the card first, then calls
    `deps.recordFolderSync(mount.driveId, getBoxTimeISO(deps.boxRoot))`, so a
    stamp that throws records no time; it returns the stamp's boolean, and the
    three call sites push `relCard` only when it is true.
  - `normalizeDriveState` returns fresh containers. A missing state file
    loads the shared `DEFAULT_DRIVE_STATE`, and the sync writes into the loaded
    maps in place, so without copies one box's sync time would show in
    another box with no state file in the same process (cross-model review).
    The same hazard already existed for `files` and `driveTrashed`.
  - `mount-list.ts`: `listFolderMounts` loads `loadDriveState(boxRoot)` and
    reads `state.folders[card.driveId]?.lastSync ?? null`.
  - `tracking.ts`: `DriveCardSummary.lastSync` removed (it only ever came
    from a folder card). `status-cli.ts` loads the state once and prints
    "Last synced" for folder cards from it; `--json` keeps `lastSync`.
  - `gfolder.tsx`: `MountHeader` takes `lastSync` from
    `trpc.drive.mounts.useQuery()`, matched on `cardPath === data.path`. The
    view already invalidates `drive.mounts` after "Sync now"
    (`gfolder.tsx:131`). While the query loads, no badge or date shows (no
    false "never synced"); when it fails, the header says "sync status
    unavailable".
  - `schemas/gfolder.ts`: remove the `last-sync` field, the
    `createGfolderTemplate` `lastSync` option, and rewrite the instructions
    sentence to say the sync time is shown by `bbx drive status` and the
    app, not stored on the card.
- **Vocabulary lock-ins:** `folders` key in `google-drive.state.json`;
  `FolderSyncRecord.lastSync`.
- **First implementation chunk:** `state.ts` + its merge test; then the stamp
  and folder-sync change with the "second pass over an unchanged folder makes
  no commit" connector test.

### Track 2 — migration `gfolder-last-sync-2026-10`

- **What:** for every `.gfolder.card` with a `last-sync` field, write that
  value into `state.folders[drive.id]` (only when the state has no newer
  record) and remove the field from the card.
- **Why:** the schema no longer has the field; a card that keeps it is stale
  data the mirror never refreshes. Seeding the state keeps the "mirrored"
  badge true between deploy and the next pass instead of showing "never
  synced" on every mount.
- **Direction:** `src/scripts/migrate/gfolder-last-sync/{plan.ts,run.ts}`
  shaped like `root-question`. `plan.ts` is pure: card text → `{ kind:
  "current" } | { kind: "strip", text, driveId, lastSync }`. It deletes the one
  key in the YAML document (`editableFrontmatterDocument`,
  `src/cards/frontmatter.ts:149`), so comments, quoting, and the body stay as
  they were. A card whose
  frontmatter does not parse, or that has `last-sync` but no `drive.id`, is a
  leftover: printed last, exit 2. Apply order: state first (under
  `updateTransientState`'s lock), then the card, so an interruption leaves a
  card that a rerun still strips. Verify by re-planning every card. The
  runner commits (`docs/cards/migrations.md:14-40`).
- **First implementation chunk:** plan + run + test on a temp box fixture.

## Could this be simpler?

Simplest: compare-before-write and drop `last-sync` from the comparison
(about 15 lines, no migration). It fails on "last sync" meaning "last change":
a mount checked every 15 minutes with no Drive edits for a week reads "last
sync a week ago", which reads as a broken mirror (principle 13). The fuller
plan buys a correct label at the cost of one state key, one migration, and a
query in one renderer.

Simpler migration: strip without seeding. Every mount reads "never synced"
until the next pass. Seeding is about ten lines; kept.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| "Sync now" (`syncFolderMount`) on an unchanged folder commits | New test: second "Sync now" makes no commit | `stageAndCommitPaths` no-diff gate (`operations.ts:383`) | Clear (tested) |
| Concurrent writers (wakeup sync and "Sync now" in another process) lose a `folders` entry | New merge test | `mergeDriveState` per-key merge, lock in `updateTransientState` | Clear (tested) |
| State file missing (fresh clone, cleared `_bookkeeping/`) | New mount-list test | `?? null` → "never synced" until next pass | Visible, self-heals |
| Migration interrupted between state write and card write | Rerun test | Card still has `last-sync`; rerun re-plans it; seeding skips when state already has a value | Clear |
| Mount card has `last-sync` but unparseable frontmatter | Migration test | Exit 2 leftover naming the path | Clear |
| Renderer shows "never synced" while `drive.mounts` loads | Exhibit | Badge hidden until query resolves | n/a |
| A card hand-edited to carry `last-sync` again | none | Card schemas accept unknown keys (`src/cards/schema.ts:573`); card lint warns (`lint-cards.ts:394`); readers ignore it | Visible as a lint warning; harmless |
| A mount unmounted and later re-created by hand for the same Drive folder shows "mirrored" with the old time until its first pass | none | None. `bbx drive mount` mirrors at once, so only a hand-written card or a legacy config conversion sees it, until the next wakeup | Accepted: the time is "when the box last mirrored this Drive folder", which stays true |

## Agent-flow / user-flow edge cases

- Wrong field: an agent asked "when did this mount last sync" reads the card
  and finds no time. ADDRESSED: schema instructions point at `bbx drive
  status`.
- Stale ref: mount card moved with `bbx mv`. ADDRESSED: keyed by Drive ID.
- Two agents: ADDRESSED by the state merge (Failure modes row 2).
- Hand-edit drift: see last Failure-modes row.
- Fabricated value: no free-form value added.
- Validation error UX: unchanged path (schema field removal).
- Partial migration: an un-migrated card keeps a stale `last-sync`; readers
  ignore it, and `stampGfolderCard` carries unknown fields through untouched.
  A box that has not yet run the migration runs it on the next sweep; a card
  given `last-sync` after the migration ran keeps it, with a lint warning.
  ADDRESSED.

## NOT in scope

- Changing what counts as "updated" for synced Doc/Sheet children: they only
  report when content changed (`file-sync.ts`), not part of this bug.
- A "last change" timestamp: nobody asked for it; `git log` answers it.
- Calendar/Gmail fixes beyond what *Calendar and Gmail* finds.

## Open design questions

none

## Knowledge audits

The schema instructions change (an agent learns the card has no sync time).
No new concept, so no new audit. `src/dev/knowledge-audits.yaml` has no entry
that mentions `last-sync`; the two Drive mount audits (`drive-three-kinds`,
`drive-mount-folder`) ask about card kinds and `bbx drive mount`, which this
plan does not change, so none was rerun.

## What will hold this after it ships

- Unit: `mergeDriveState` with `folders`; `stampGfolderCard` returns false on an
  unchanged card; migration `plan.ts` cases.
- Connector tier (existing `google-drive.folder*.test.ts` fake service): a
  second pass over an unchanged folder leaves `git log` length unchanged and
  updates `state.folders`.
- tRPC `drive.mounts` test reads `lastSync` from state.

## Implementation order

1. State `folders` + merge test.
2. Stamp/sync change + no-commit tests; readers (`mount-list`, `status-cli`,
   `tracking`); renderer; schema text; docs.
3. Migration + test + registry entry; run on the worktree box clone.
4. Exhibit; cross-model review; close the issue.

## Rollout shape

Done when: the no-commit connector test, the "Sync now" no-commit test, the
merge test, the migration tests, and the existing Drive tests pass; the
migration runs clean on a box clone holding a seeded `.gfolder.card`. The
migration is a script, applied by the deploy sweep. No legacy-tolerance code
is added, so no deferred cleanup issue.
