# Portable encrypted box backup — 2026-10-25 research snapshot

The boxholder wants scheduled, configurable, encrypted backups across server,
Mac app, Compose/NAS, and laptop installs. Secrets belong in the backup. The
snapshot format should be an existing tool's, and reinstallable software and
rebuildable caches stay out. This note informs the open
[backup decision](../../issues/closed/decisions/2026-08-07-server-backup-story.md);
it is not a plan or an implementation.

## Inventory and restore value

| Data | Decision | Evidence and reason |
| --- | --- | --- |
| Box source and content: `_content/`, `_config/`, `_bookkeeping/`, `_publish/`, `src/`, root guidance, package files, authored agent guidance, dirty and ignored intake | Back up | The box is a package and operational root; staged output, connector state, inbox files, and uncommitted work cannot be reconstructed from a Git remote. `beebox/docs/box-layout.md:85-105,125-160,187-226`. |
| `.git/` including refs and `.git/annex/objects/`, plus working attachment files | Back up | Git push carries history and annex pointers, never annex bytes. Non-thin annex keeps a second working copy of assets; a snapshot may deduplicate it. `beebox/src/core/box/backup-status.ts:2-9`; `beebox/docs/media/assets.md:10-25,229-235`. |
| `.beebox/` credentials and durable workflow state | Back up selectively | Agent/mobile/scan tokens; chat schedule and session history; quick-chat open/closed records; notification intent log; retro observations/state; chat review state; location/uploads and delete retry markers carry state or prevent replay. See `beebox/docs/box-layout.md:246-269`, `beebox/src/core/notification/intent.ts`, `beebox/src/core/retro/state.ts`, `beebox/src/core/chat/review/state.ts`. A blanket `.beebox/` exclusion would lose data. |
| `.beebox/events.db*`, `usage.db*`, search indexes, generated guide/docs, locks, logs, PIDs, engine symlink, `_tmp/`, `node_modules/`, caches | Rebuild or omit | Event bus is explicitly ephemeral (`beebox/src/core/event-bus/core.ts:17`); usage can rebuild from session logs (`beebox/src/core/usage.ts:2-9`). Engine symlink is machine-specific (`beebox/docs/box-layout.md:63-70`). Do not live-copy SQLite WAL files as ordinary files. Check individual temporary paths for accepted but unfinished uploads before excluding them. |
| Per-box `~/.config/beebox/secrets.json` (or `BBX_SECRETS_FILE`), `~/.bbx-auth.json` (or override), session secret, Google token store | Back up | Secrets are outside box by design (`beebox/docs/secrets.md:4-6`); auth and session files are outside too (`beebox/src/webapp/local-users.ts:2-17`, `beebox/src/webapp/auth.ts:30-57`). Some credentials are shared across local boxes, so a one-box restore cannot blindly replace the machine's whole store. |
| Per-box Claude/Codex auth and transcripts; `~/.local/share/beebox/` origin ID and push subscriptions | Back up or deliberately reauthorize | Transcripts and login live in CLI home/config, and transcript lookup uses encoded absolute paths (`beebox/src/core/chat/session/transcript-paths.ts:38-99`; `beebox/src/services/codex-rollout-model.ts:35-74`). Restoring to a new path needs mapping. Origin ID and push subscriptions are machine state (`beebox/src/core/chat/session/origin.ts:43-55`; `beebox/src/core/push-subscriptions.ts:67-76`). Credentials can instead be reauthorized if the boxholder accepts that recovery step. |
| Hub routing config and scheduler manifest | Host rebuild material | `hub.json` and `boxes.json` register boxes on a multi-box server (`beebox/docs/server/provisioning.md:118-129`). Hub recency state and `/run/beebox/*.hub-secret` are rebuildable (`beebox/src/hub/supervisor/state.ts:1-20`; `beebox/src/hub/secrets.ts:1-8`). The hub master secret store also needs its own protected host backup; a per-box snapshot must not copy other boxes' secrets. |
| `~/.cache/beebox/`, shared model/package caches, installed engine/image, VM disk | Omit | Code search found only development/PID/performance use under that cache root. Mac host mounts provide the data to the VM, while the image and VM runtime can be recreated. `mac-app/Sources/BeeBoxMac/Paths.swift:3-79`; `mac-app/Sources/BeeBoxMac/BoxRuntime.swift:335-347`. |

### Install placement

- **Production:** `/var/lib/beebox/<slug>/box` and sibling per-user home under
  `/var/lib/beebox/<slug>/`; each box has its own Unix user and per-box secret
  share. The hub has a separate master store and config under `/home/beebox`;
  scheduler manifest is under `/var/lib/beebox-sched`. The box volume is separate
  from the server disk and excluded from Hetzner server snapshots.
  `beebox/docs/server/provisioning.md:115-147`.
- **Mac app:** box under `~/BeeBox/<name>`, with `~/Library/Application Support/Bee Box/home`
  and `claude-config` mounted into the VM. Back up host data directories, not
  VM disk images. `mac-app/Sources/BeeBoxMac/Paths.swift:3-79` and
  `BoxRuntime.swift:335-347`.
- **Compose/NAS:** `./data/box` bind mount, plus `home` and `claude-auth` named
  volumes (`beebox/docker/compose.yaml:27-38`); Caddy state is separate host
  infrastructure. The image and packages are reinstallable.
- **Local:** commonly `~/src/boxes/<name>`, with machine secret/auth/state
  stores in the user's home. `beebox/docs/box-work.md:9-15`.

## Existing mechanisms and gaps

Admin Backup currently reports Git remote/upstream and annex risk; it does not
create copies (`beebox/src/core/box/backup-status.ts`,
`beebox/src/frontend/src/components/admin/BackupSection.tsx`). `bbx wakeup`
pushes committed Git changes to an optional remote, but push failure is
nonfatal and annex content is separate (`beebox/src/cli/commands/wakeup/command.ts:101-114`).
Migration recovery refs preserve operation input in Git, not off-machine data
(`beebox/docs/cards/migrations.md:94-123`). The proposed agent-readable export
guide is about getting data out and mentions only a Git remote
(`issues/features/2026-07-20-export-md-agent-instructions.md`). Dormant-box
encryption is a separate at-rest proposal, not a current backup facility
(`issues/exploration/2026-08-11-encryption-at-rest.md`).

## Tool comparison (official sources checked 2026-10-25)

| Tool | Fit and trade-off |
| --- | --- |
| **restic 0.19.1**, BSD-2 | Client-encrypted, incremental/deduplicated snapshots; local, SFTP, S3-compatible, B2, REST, and rclone backends. `forget`/`prune`, `check`, full and path-filtered restores, single binary for Linux/macOS, JSON scripting. Scheduling is external. Multiple repository passwords can be managed; one strong recovery password must be kept outside the backed-up machine. [Docs](https://restic.readthedocs.io/en/stable/), [releases](https://github.com/restic/restic/releases), [license](https://github.com/restic/restic). |
| **Kopia 0.23.1**, Apache-2.0 | Encrypted, incremental/deduplicated snapshots with built-in policy scheduling and retention, CLI/GUI, local/S3/B2/SFTP/WebDAV. Its rclone support is marked experimental. Easier policy surface, but its resident scheduler/server and repository maintenance add another lifecycle to integrate with Bee Box's varied installs. [Docs](https://kopia.io/docs/repositories/), [policies](https://kopia.io/docs/getting-started/), [releases](https://github.com/kopia/kopia/releases). |
| **Borg 1.4.5 stable** (2.0 beta), BSD-3 | Strong encrypted deduplicated archives, retention/prune and individual extraction; local or SSH/Borg server is its mature path. It has standalone binaries, but the target normally needs Borg too, and B2/S3/rclone need another layer; less universal for user-chosen destinations. [Docs](https://borgbackup.readthedocs.io/en/stable/), [releases](https://github.com/borgbackup/borg/releases). |
| **git-annex encrypted special remote + git-remote-gcrypt**, AGPL-3+/GPL-3 | Makes annex `numcopies` truthful and encrypts Git and annex data, but requires two coupled remotes, GPG custody, and does not cover ignored runtime state or external secrets. gcrypt's SFTP/arbitrary-Git transports can reupload full history per push and its README warns pushes effectively force updates. Poor fit as the sole basic backup. [annex](https://git-annex.branchable.com/special_remotes/gcrypt/), [gcrypt](https://github.com/spwhitton/git-remote-gcrypt), [license](https://git-annex.branchable.com/license/). |

All are free software; the main recurring monetary cost is the chosen storage
service, capacity, requests and possibly retrieval/egress. There is no honest
fixed price until a destination, data size and retention are chosen.

## Consistency, scheduling, and restore

Restic snapshots a live file tree over time, not one atomic instant. Box Git
can change its index/refs while files or annex objects are written; accepting a
half-written object or mismatched pointer would make a snapshot unusable.
Secrets and auth files use atomic replacement, so a read gets a valid version,
but it may be from a different moment than the box tree
(`beebox/src/core/secrets/store.ts:1-20,253-280`,
`beebox/src/webapp/local-users.ts:15-17`). SQLite WAL databases need a proper
SQLite backup or should be rebuilt; the current event/usage DBs support omit.
The existing box-maintenance admission closes a box to new work and drains
active holders (`beebox/src/lib/box-maintenance/admission.ts:319-350`), a
plausible consistency barrier. The design still must handle external CLI
writers and secret-store writes, and bound the pause while media is copied.
Portable options are: hold writers for the full snapshot, or stage a consistent
copy under the hold, release, then let restic upload it. A filesystem snapshot
can shorten the hold where available, but cannot be the universal mechanism.

Prefer a box/host-owned runner using one backup command with explicit config,
not hub routing and not an agent-authored script holding its own decryption
credential. Existing `bbx tick` schedules run under the box user on local
launchd and server systemd (`beebox/docs/scheduler.md:3-27,127-137`), but the
Mac app and Compose currently run `serve` without that scheduler
(`beebox/docker/entrypoint.sh:147-149`). They need their app/host scheduling
adapter or scheduler integration. Store destination, retention and last-run
status in non-secret per-box configuration; store backup credentials and the
unattended unlock credential with restricted permissions outside the box data.
Exclude the backup unlock credential itself from the snapshot, and give the
boxholder a separate recovery password in their own password manager or offline
record. A backup password stored only on the failed box cannot restore it.
The destination's write credential should ideally be limited so a
compromised box cannot delete old backups; retention then needs separate
authority where supported.

Default restore should be a **whole box at a selected point in time** to an
empty destination: provision the engine/host, restore Git and annex plus
selected state and secrets, repair paths/ownership, run init and health checks,
then register/start the box. A single-file restore can be offered through the
underlying tool without merging into a live box automatically. Incremental
storage does not imply an incremental restore; restic assembles a complete
selected snapshot. A scheduled test should restore to a throwaway box, verify
Git, annex object integrity, auth/secret file readability without using
credentials, and representative cards/attachments, then discard it. Such a
test must be isolated from connectors and outgoing actions.

## Disposition and decisions

- **Adapt restic** as the common encrypted backup engine. It meets the diverse
  destination requirement with a small CLI and no custom archive format.
- **Adapt the existing box-maintenance gate** for a consistent capture, after
  testing its coverage of Git, annex, transcripts and external secret writes.
- **Reject Git remotes/annex remotes as the sole backup** because they omit
  ignored state and external secrets. Keep them as useful independent copies.
- **Later:** dormant-box encryption; it answers a different threat model.

Before planning, decide the default destination guidance (local removable disk
versus remote object/SFTP), recovery-password handoff, retention policy, and
whether first release must support single-file UI restore or can offer whole-box
restore plus the restic CLI. These choices set the user-facing setup and
recovery flow.
