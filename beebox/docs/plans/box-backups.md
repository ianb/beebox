---
title: "Encrypted, scheduled backups of box data"
status: draft
workstream: box-backups
issues:
  - ../../../issues/decisions/2026-08-07-server-backup-story.md
---
# Encrypted, scheduled backups of box data

Create a one-shot operator command that captures a box and its durable outside-the-box state into an encrypted restic repository. Install-specific timers call the same command. A restore command recovers a selected snapshot into an empty box location.

**Issues addressed:** [server backup story](../../../issues/decisions/2026-08-07-server-backup-story.md). The related [export guide](../../../issues/features/2026-07-20-export-md-agent-instructions.md) and [dormant-box encryption](../../../issues/exploration/2026-08-11-encryption-at-rest.md) remain separate work.

## Design

### Situations

- When an operator sets up a box on a server, Mac app, NAS, or laptop, I want to choose a repository, unlock key, and schedule from a command line, so I can recover the box after losing that machine.
- When a scheduled backup fails, I want a nonzero result and a concrete reason, so I know the last usable snapshot is older than expected.
- When I replace a failed machine, I want to select a complete snapshot and restore into an empty box location, so I can inspect it before starting the box.
- When I am using a box, I do not want a backup to silently interrupt work or claim success before the snapshot is complete.

### Right place, right time

| Situation | Act, show, or quiet | Surface | Attention |
| --- | --- | --- | --- |
| Setup | Show required destination, key custody, schedule, and first-run result | `bbx engine backup` CLI and install guide | Deliberate operator action |
| Scheduled success | Tag the checked snapshot `verified`; report the resulting ID, time, and duration | CLI status/host logs | Quiet |
| Scheduled failure or stale last success | Report the failing stage and last verified snapshot | Nonzero CLI exit and host/app scheduler log | Visible to operator; no new notification channel |
| Restore | Require an empty target, show selected snapshot and included data before writing | CLI | Deliberate operator action |
| Backup while box is busy | Wait for admitted work with a bounded drain; report a pause or timeout | CLI/status | Background, then explicit failure if it cannot capture |

### Spirit

- **Serves:** `docs/architecture/spirit.md`, “You should be able to see the gears”: a result names its snapshot and verification evidence.
- **Risks:** “The best stuff comes from the people”: an exclusion mistake would lose authored bytes. Inventory tests and a real restore before rollout guard against that.

### Trust

Setup and restore are explicit operator actions. The recorded schedule authorizes later backup runs and retention. A run never creates or changes a Git remote and never sends data to an unconfigured destination. Changing destination, key, or retention needs another explicit command; a box agent has no backup verb. Setup states that the unattended credential is available to processes running as the box's OS user, so encryption protects backup confidentiality but not deletion by a compromised box. Recommend destination-side versioning or immutability where available.

### When it goes wrong or does nothing

An absent key, unreachable destination, inaccessible local path, insufficient space, busy box, partial restic snapshot, failed integrity check, or unreadable external state fails with a named stage and leaves the last verified snapshot visible. An unconfigured box reports “backup not configured”; it never implies that its Git remote is a complete backup. A Mac app that was closed waits for an idle window after reopening, then runs an overdue backup; its log reports that intervening runs were missed. If the box remains busy, the backup remains due.

### Walkthrough

The operator runs setup with a repository URL, an existing protected password file, and a daily schedule. Setup initializes or validates the repository, checks write access, records the schedule, and runs a first backup. Later, the host timer starts `bbx engine backup run <boxRoot>` outside the normal box scheduler pass. The command refuses unfinished maintenance, closes admission, drains current work, captures the selected files with restic, releases admission, checks the new snapshot, and tags it `verified`. It re-reads and reports the new snapshot ID because tagging changes that ID. `bbx engine backup status <boxRoot>` reads restic's verified snapshots and shows the newest ID and time. After a machine loss, the operator installs the engine and restic, supplies the recovery password, and restores a verified snapshot to an empty location before enabling the box.

Other paths use the same command: a failed upload leaves a nonzero host timer result and no new verified tag; a Compose host runs the one-shot container with its existing mounts; the Mac app invokes the command inside its running VM when a backup is due or overdue. The restore test uses an isolated throwaway destination and never starts its connectors.

## Smallest fix and budget

The smallest useful version is a documented restic command with an include list and host cron. It would cover one install but would miss ignored state, outside secrets, consistency, and a repeatable restore. The chosen scope adds one operator CLI, explicit data selection, verified snapshot tags, restore validation, and timers for the supported install types. Target roughly 750–1,000 changed TypeScript source/test lines, 150–250 deployment and Mac integration lines, and 150–250 authored documentation lines, excluding this plan and review artifacts; generated output is none. Reassess if the total approaches 2,000 changed lines. The plan ships as one unit.

## Stated preferences this plan trades against

- The boxholder chose an existing encrypted backup system, recurring runs, secrets included, a chosen destination/key, command-line control, and no separate backup surface (`issues/decisions/2026-08-07-server-backup-story.md:31-55` and the 2026-10-25 discussion). Restic is the archive format; Bee Box supplies orchestration only.
- A Mac app initiated cloud-to-local copy is future work. Use ordinary restic repositories and stable snapshot metadata so a later Mac client can copy or mirror them without changing the stored box format. The exact pull path is not designed here.
- `beebox/AGENTS.md:7`: *“`bbx` is the box agent's surface, not yours.”* Backup belongs under `bbx engine`, outside agent reach.
- `docs/architecture/spirit.md`, “You should be able to see the gears,” favors an inspectable result over a silent timer. `docs/design/trust.md`, “Trust to keep,” makes omissions and restore verification first-class.

## What already exists

- `src/core/box/backup-status.ts:5-8`: *“`git push` carries cards, text, and — on an annexed box — the annex POINTERS. It never carries the asset bytes”*. Reuse its warning, but do not report restic success from Git state.
- `src/cli/commands/wakeup/command.ts:101-104`: *“Push committed changes to the box's git remote”* and *“push errors … are logged but don't fail the wakeup.”* This is not the backup path.
- `src/lib/box-maintenance/admission.ts:357`: *“Single-box callers close and drain in one operation.”* Reuse `acquireBoxMaintenance` for the capture barrier. Do not call the deployment-only maintenance command: `src/cli/commands/maintenance/hold.ts:50-52` always creates a migration snapshot.
- `src/core/schedule/scheduler/pass.ts:27-35`: *“Run the pass under fresh admission.”* A backup must run outside this pass; starting exclusive maintenance inside it conflicts with its own admitted work.
- `src/core/secrets/export-box.ts:2-10`: *“One box's share of the machine secret store, as a store of its own.”* Use it where a machine store contains multiple boxes. The command must not back up other boxes' values.
- `src/core/chat/session/transcript-paths.ts:4-6`: *“Claude Code stores session transcripts as JSONL files”* outside the box, keyed by encoded cwd. Existing `history.ts` enumerates this box's roots; reuse it. Codex rollouts have a separate date-based location (`src/services/codex-rollout-model.ts:4-8`).
- `mac-app/Sources/BeeBoxMac/Paths.swift:3-13`: *“Two roots”* put box files in `~/BeeBox` and shared runtime/auth state under Application Support. `beebox/docker/compose.yaml:27-38` likewise separates box, Claude, and home mounts.
- `beebox/docs/server/provisioning.md:145-147`: *“A Hetzner snapshot of the server does not include a volume”* holding production boxes. The first off-host snapshot is a priority.
- Search of `beebox/src` and `beebox/docs` found no restic invocation or general backup command as of this plan. Admin Backup is read-only (`src/frontend/src/components/admin/BackupSection.tsx:1-12`).

## Prior art (external)

- **Adopted:** [restic backup and exclusion rules](https://restic.readthedocs.io/en/stable/040_backup.html), [repository keys](https://restic.readthedocs.io/en/stable/070_encryption.html), [forget/prune](https://restic.readthedocs.io/en/stable/060_forget.html), [restore](https://restic.readthedocs.io/en/stable/050_restore.html), and [copy between repositories](https://restic.readthedocs.io/en/stable/045_working_with_repos.html). Restic supplies encryption, deduplication, snapshots, retention, and local/SFTP/S3/B2/rclone backends; Bee Box must supply scheduling and a consistent file set. Credit restic in `ACKNOWLEDGEMENTS.md` when this ships.
- **Evaluated:** [Kopia repository synchronization](https://kopia.io/docs/advanced/synchronization/) is a useful future Mac-pull precedent. It does not change this plan's tool choice.
- Restic's docs say `forget --prune` can lock a repository for a long time. Schedule pruning separately from the capture and preserve the last verified snapshot on any maintenance failure. Restic [changes a snapshot ID when tagging](https://restic.readthedocs.io/en/stable/manual_rest.html#managing-tags), and [retention groups by host and paths by default](https://restic.readthedocs.io/en/stable/060_forget.html).
- **Local experiment, 2026-10-25:** official restic 0.19.1 Darwin binary (release checksum verified) backed up a synthetic Git/annex box and separate synthetic secret file to a local repository. An empty-target restore recovered the Git commit, annex bytes, and secret file; `restic check` passed. This validates restic's basic snapshot shape, not Bee Box's unbuilt selection or maintenance logic.

## Ontology

- **Box root** (existing): the resolved version-3 package directory; identifies the box files, not its external machine state (`docs/box-layout.md:9-15`).
- **Backup configuration** (new): per-box, machine-owned record of repository URL, password-file path, schedule, retention, and references to backend credentials; it holds no secret values and is not itself a recoverable snapshot. Each box uses its own repository, so repository access and pruning cannot span boxes.
- **Backup identity** (new): a generated ID recorded in configuration and on restic snapshots; it binds a repository to one box without depending on hostname or the box's current absolute path. A recovered operator can read it from the repository.
- **Recovery password** (restic): the secret that unlocks the repository on a new machine; the operator keeps a copy outside the backed-up machine. The unattended password file is its machine copy, excluded from snapshots.
- **Snapshot** (restic): one selection of box data and external state, identified by restic snapshot ID. A `verified` tag means backup exited zero and repository check passed; restore defaults to the newest verified snapshot. Tagging replaces the snapshot object and changes its ID, so status and logs report the ID after tagging. Incremental storage does not change this restore unit.
- **Restore target** (new CLI argument): an empty directory; never the running box root.

## Tracks / scope

### 1. Capture inventory and restic runner

**What.** Add an operator-only `bbx engine backup` family in `src/cli/commands.ts` and `src/cli/entry/surface-data.ts`. Exempt the family from default work admission in `src/cli/lib/box-admission.ts`, then acquire single-box maintenance itself. The core runner resolves one box root, selects included paths, invokes restic with argument arrays and a password file, and rejects a repository inside any included source. Do not pass credentials in argv or logs. A config file outside the backed-up box names destination, password file, cadence, and retention; `configure` validates it and runs an initial backup. Require an empty repository or one already bound to this box's backup identity; refuse an unrelated repository. The portable first-release destination is a network repository reachable from the box runtime: SFTP, S3-compatible, B2, or rclone. A bare local box may use a local path that is already accessible. The production sandbox cannot write an arbitrary `/mnt` path (`deploy/systemd/box-sandbox.conf:26-31`), and the Mac VM only sees its declared mounts (`mac-app/Sources/BeeBoxMac/BoxRuntime.swift:342-347`); configuring either with an unmounted local path fails with an actionable explanation. Do not add new host mount permissions in this plan. Package or document a pinned restic binary for the Docker/Mac VM image and install it on the server/local host.

**Why.** A raw box-directory snapshot misses outside state; a whole-home snapshot leaks other boxes and includes rebuildable caches. The selection starts with the box tree including Git and annex; excludes `node_modules`, engine link, generated docs, indexes, ephemeral SQLite and logs; includes durable `.beebox` records, selected per-box secret share, auth/session files where per-box, and per-box Claude/Codex transcripts. Treat missing expected state as a failure, not an empty directory. `research/box-backups/2026-10-25-portable-encrypted-backup.md` records the first inventory; validate every path in this track against current writers.

**Direction.** Check `boxMaintenanceStatus` first and refuse any unfinished maintenance record, naming its original reason. In a `try/finally`, close and drain box admission, run `restic backup` while held, and always release. This first version trades temporary box availability for a stable box tree and no duplicate staging volume; the one-box secret share does need a restricted 0600 staging file because `exportBoxStore` returns an object and restic stdin backup cannot combine it with path arguments. Give staging a fixed per-box path in the machine config directory, then restrict it to 0600. The barrier does not stop independent writes to machine-level secret/auth stores or CLI transcript files. Read atomically replaced stores into restricted temporary files, detect changed transcript files as a failed run, and remove staging on every exit; a prior crash's staging is found and removed before retry. The snapshot is coherent per file but is not a single atomic instant across independent stores. Run at a configured quiet time; show duration and a clear “backup waiting for box work” status. If upload duration proves unacceptable on a representative annex-heavy throwaway box, return for a staging or filesystem-snapshot decision before rollout rather than silently backing up live files. Use the stable backup identity as restic's `--host` and `--group-by host` on backup so a changed machine path or hostname does not make each run a new retention group. Restic must exit zero and return a snapshot ID, then `restic check` must pass, before `restic tag --add verified <id>` marks it restorable by default. Re-read the tagged snapshot and report its new ID. A nonzero backup may leave an unverified snapshot in the repository; it never becomes the default restore candidate.

**Vocabulary lock-ins.** `configure`, `run`, `status`, `check`, and `restore` are operator verbs. Keep configuration as machine state, not cards or Git history. The first chunk registers and tests the operator command, validates config/key/repository reachability, refuses unfinished maintenance, and captures a small throwaway box to a local restic repo with a failure-safe maintenance release and verified tag.

### 2. Recurrence, retention, and failure visibility

**What.** Wire an install-specific timer to `bbx engine backup run <boxRoot>`: a per-box systemd timer/service on the unit server, launchd for a local laptop box, an app-owned due check and VM command for the Mac app, and a documented host timer/Compose one-shot for Docker/NAS. The Mac app waits for ten minutes with no admitted box work before starting an overdue backup after reopening; if activity continues, it leaves the run due and retries the idle check while open. A user can run the CLI command immediately. The app does not install a new background service. Invoke a command in the existing VM with `container.exec` (`mac-app/Sources/BeeBoxMac/BoxRuntime.swift:394`), not `runOnce`, which deletes the named container before creating another (`BoxRuntime.swift:367-378`). Do not use `_config/schedules/*.scheduled-script.card`: the existing scheduler pass holds box work admission (`src/core/schedule/scheduler/pass.ts:31-35`). The server timer's unit runs as `bbx-<slug>` under the existing box sandbox, without widening `bbx-box-run`'s scheduler-only sudo command (`deploy/server-bin/bbx-box-run:64-81`).

**Why.** Recurrence must work where `bbx tick` is absent, and the backup must own the exclusive barrier. A successful capture followed by a failed retention pass is still a usable snapshot; the host log must distinguish the failure from capture failure.

**Direction.** Default cadence daily and retention of seven daily, four weekly, and twelve monthly verified snapshots, overridable at setup. Run `forget` for verified snapshots with `--tag verified --host <backup identity> --group-by host`, then prune as separate scheduled maintenance after successful capture; never prune another box's snapshots. Remove unverified snapshots older than two days by their explicit IDs after listing snapshots for this backup identity; keep newer ones for retry and inspection, and never select a verified ID for that cleanup. This bounds incomplete runs without treating them as recovery points. `status` reads restic snapshots/tags, while a failed due run exits nonzero with a stage in the host/app log. Map an existing maintenance owner to “backup could not start: box maintenance already running”; map a second backup process to “backup already running” only if its owner reason is backup. Do not add Admin controls. Correct the existing read-only Admin Backup wording so “only on this machine” is explicitly about Git/annex copies and does not falsely claim that restic snapshots are absent; it need not read restic state.

**Vocabulary lock-ins.** Schedule belongs to the host/app runner, not a box-authored scheduled script. The first chunk adds a due-run command and one local scheduler adapter, then exercises missed-run, duplicate-run, and failed-run logging before wiring the other installations.

### 3. Restore and recovery proof

**What.** Add `bbx engine backup restore --snapshot <id> --target <empty-dir>` and a documented host rebuild sequence. Require an empty target and explicit repository/password input independent of the lost config. Restore box tree and the selected external data into a staging layout, validate Git refs and annex bytes, then place external files in their destination after review. Avoid overwriting a shared machine secret/auth store during a one-box restore; merge only that box's secret share or require a fresh isolated host. Repair ownership and machine-specific paths, relink/reinstall the engine, then register/start the box.

**Why.** A readable restic snapshot is not proof that the box can run. A restore into an existing shared home could overwrite other boxes' accounts or credentials. CLI transcripts whose encoded cwd changes need an explicit remap or a “history unavailable until path repair” warning.

**Direction.** Support whole-box restore first, plus restic CLI instructions for a single file. Before rollout, perform and document a manual restore into an isolated throwaway box without connectors or outbound actions. Check representative card content, Git history, annex object integrity, durable `.beebox` state, and selected external files. Never start the restored box automatically. Automated periodic restore drills are future work if manual operational checks prove insufficient.

**Vocabulary lock-ins.** A restore target is empty; a manual verification target is disposable. The first chunk restores a local test snapshot to an empty directory and proves the refusal on a nonempty target.

## Could this be simpler?

The simplest version is an operator-provided `restic backup <boxRoot>` cron line. It fails to include secret stores, outside transcripts and ignored runtime records, and it can read Git and annex mid-write. The fuller plan buys a complete, verifiable recovery unit, matching “Trust to keep” in `docs/design/trust.md`. No daemon, new archive format, backup UI, or cloud-provider integration is needed.

## Subplans

None. The capture pause is an explicit first-release tradeoff, not a research-and-decide subplan. A staging design would be a later plan if the measured pause is unacceptable.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
| --- | --- | --- | --- |
| Config points repository inside captured tree, causing recursive growth | Planned config test | Planned rejection before restic | Clear |
| Password file is missing, loose-permissioned, or included in source | Planned config test | Planned rejection/exclusion | Clear |
| An earlier migration left unfinished maintenance | Planned precheck test | Refuse before acquiring; preserve original reason | Clear |
| Maintenance drain times out or owner lock expires | Existing admission tests plus planned runner test | Planned abort, release, no verified tag | Clear |
| Restic uploads some data then exits nonzero and leaves a snapshot | Planned interrupted-run test | Leave it unverified; retry next run; restore defaults to verified | Clear |
| A new durable `.beebox` path is omitted by the selection | Planned inventory fixture and manual restore | Release review of new writers | Clear if detected; residual risk if code changes without updating inventory |
| Shared local secret store contains another box | Planned two-box test | Export one-box share; do not copy entire store | Clear |
| Machine-level store changes during capture or a temp export survives a crash | Planned atomic-copy and stale-staging tests | Capture a valid file version, restrict staging, clear stale staging on retry; report cross-store timing limit | Clear |
| A CLI transcript grows while restic reads it | Planned append-during-capture test | Refuse that snapshot as good and retry later | Clear |
| Restic check or prune fails after a snapshot succeeds | Planned tag-state test | Check failure leaves new snapshot unverified; prune failure preserves verified tag and exits nonzero | Clear |
| Two timers overlap | Planned concurrency test | Existing maintenance owner lock rejects the second; reason distinguishes another backup from other maintenance | Clear |
| Restore target contains data or points at a live box | Planned target test | Refuse before writing | Clear |
| Restore has Git pointers but missing annex bytes | Planned corrupt/missing-object test | Refuse activation and report paths | Clear |
| Mac app closed at scheduled time | Planned reopen and idle-window tests | Wait for ten idle minutes after reopening; record missed interval and retry while busy | Clear |

## Agent-flow / user-flow edge cases

- **ADDRESSED — wrong box or destination:** resolve the box root and display it with the repository before setup; reject a repository within it. The operator-only verb is inaccessible to a box agent (`src/cli/entry/surface-data.ts:166-178`).
- **ADDRESSED — stale config or moved box:** bind config to a resolved box identity/path and refuse a different box; restore accepts explicit repo/key without the old config.
- **ADDRESSED — concurrent agents or scheduler:** maintenance drains admitted work; the backup runs outside scheduler-pass admission (`src/lib/box-maintenance/admission.ts:357-361`; `src/core/schedule/scheduler/pass.ts:31-35`).
- **ADDRESSED — hand-edited config:** strict validation names the invalid field and file, like `src/core/box/boxes-config.ts:33-55`.
- **ADDRESSED — fabricated success:** only restic's zero exit, snapshot ID, and passing repository check add the `verified` tag. Restore ignores untagged snapshots by default.
- **DEFERRED — single-file UI restore:** restic can select files, but no Bee Box surface is added in this release.
- **DEFERRED — Mac cloud-to-local copy:** keep standard restic repositories and snapshot IDs; the Mac pull transport and authorization need a later design.

## NOT in scope

- Mac app initiated backup of a remote cloud box onto the Mac; this plan only backs up a box at its current host.
- New Admin controls, backup cards, chat notifications, or agent-authored backup scripts; the command line and existing host logs are the control path. Existing Admin wording may be corrected to identify its narrower Git/annex evidence.
- Git/annex remote configuration or changing `numcopies`; these remain independent copies.
- Dormant-box encryption or live-disk encryption; restic encrypts the backup repository.
- Automatic merge into a running box, automatic activation after restore, and a single-file Bee Box UI.
- Backing up the engine, Docker image, VM disk, `node_modules`, caches, indexes, or generated docs.
- Host-wide disaster recovery of the hub master store, routing manifest, and other boxes. Document those as separate host recovery material; a per-box snapshot must not contain them.
- Automatically exposing a local drive to the production sandbox or Mac VM. Initial network destinations work from both; a bare local box can select an already accessible local path. Future local-machine pull remains separate.
- Protecting backups from an agent or process that owns the unattended key and destination credential. The box agent runs as the same OS user on current installs. Recommend versioning or immutability at the destination where supported; describe this limitation plainly. Separate delete authority is future work.
- Automated scheduled restore drills and periodic full-data reads. The initial rollout requires a manual isolated restore; the operator may run `bbx engine backup check` and restic's full-data check by command.

## Open design questions

None for the first chunk. The chosen default is a temporary box pause for the full restic capture, network repositories on sandboxed server/Mac installs, a ten-minute idle window before a Mac catch-up run, daily cadence, seven daily/four weekly/twelve monthly retention, and whole-box restore into an empty target. Representative timing and restore evidence are rollout gates; a failed gate reopens the design before shipping.

## Knowledge audits

The operator command is not box-agent guidance, so no box `knows_directly` entry is needed. The installation docs will name the backup command. If implementation adds an agent-facing `bbx` explanation, add and run a knowledge audit then.

## What will hold this after it ships

Pure inventory/config selection tests cover inclusions, omissions, and isolation between boxes. A CLI integration test uses a throwaway box and local restic repository for capture, interruption, second snapshot deduplication, and restore. Unit tests cover verified tagging, unfinished-maintenance refusal, maintenance release, and empty-target refusal. A manual isolated restore before rollout checks the full recovery path; it is operational evidence, not a substitute for those behavior tests. The normal changed-test/typecheck/lint/layout gates apply. No new general test tier is needed.

## Implementation order

1. Land inventory/config selection and the one-shot restic command, with local throwaway capture and failure tests. Credit restic in `ACKNOWLEDGEMENTS.md` in this chunk.
2. Add status, retention, and per-install scheduling adapters. Keep timer failures visible and verify missed-run behavior.
3. Add restore command, perform a manual isolated restore, and write installation/recovery documentation. Complete all tracks before asking to land the plan.

## Rollout shape

Start with a throwaway box and local restic directory. Verify include/exclude selection and restore, then interrupted backup, concurrent run, and key-loss/refusal cases. Exercise a representative annex-heavy throwaway box to measure the admission pause and disk/network cost. On server, use code and read-only deploy status for the production topology; never probe production data as part of planning. Deploy first to an opt-in test installation, run a successful backup and isolated restore, then enable per-box schedules. `status` distinguishes configured, never-run, and newest verified snapshot; the host/app timer log carries the latest failed-run stage. Existing boxes require no on-disk migration; backup begins only when an operator configures a repository and key.
