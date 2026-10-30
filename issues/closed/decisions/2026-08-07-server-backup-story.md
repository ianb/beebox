---
title: "Box data has no easy backup, on the server or any other install"
workstream: box-backups
area: beebox
filed-by: agent
discovered-in: worktree-security-report — operational inventory for the security report
priority: normal
resolution: implemented
---

**Closed 2026-10-26** — implemented by commit `56be01944`. The boxholder chose
encrypted Restic snapshots configured and controlled through the CLI, with
installation-specific schedules and whole-box restore. This resolves the
backup-story decision with per-box snapshots rather than requiring Git and
annex remotes or relying on provider snapshots. Mac-initiated cloud-to-local
backup remains outside this work and is recorded in the partial plan.

The deployed server has no first-class backup mechanism.
`docs/server/operations.md` defers to "whatever backup mechanism is
currently configured for the server"; git-annexed assets are
`numcopies: 1` with no annex remote (`docs/media/assets.md`); only migrations
take a tar snapshot, scoped to that operation. A box's git remote (the
one `bbx wakeup` pushes to) is operator-chosen and optional — boxes
without one have exactly one copy of their history, and annexed media
has one copy regardless.

Single-disk-loss on the VPS could be unrecoverable for anything not
covered by an operator's own remote. The decision: what is the blessed
backup story — mandatory per-box git remotes plus an annex special
remote? VPS-level disk snapshots? Documented as the operator's problem
with a checklist? The security report lists this as an accepted risk
until decided.

## Audit 2026-10-22

Partly addressed, no backup story decided. Admin now has a read-only Backup section (commit 142e76168, `beebox/src/frontend/src/components/admin/BackupSection.tsx`, status in `beebox/src/core/box/backup-status.ts`) that shows where copies of a box exist and warns when asset bytes exist only on this machine. `beebox/docs/server/boxes.md:232` points to it. It reports and does not back up. `beebox/docs/media/assets.md:231` still says there is no annex remote and `numcopies` is 1. The decision (mandatory remotes, annex special remote, VPS snapshots, or operator checklist) is still open.

## Boxholder direction (2026-10-25)

The boxholder wants a box's basic data to be easy to back up, on every
install (server, Mac app, NAS, a laptop box), not only the server:

- **Scope: the data, not the reinstallable parts.** The box's git history,
  its annexed asset bytes, and whatever box state cannot be rebuilt. Leave
  out what an install recreates: the engine, `node_modules`, caches, search
  indexes, generated docs. Which secrets belong in a backup is an open
  question; a backup that holds them must be encrypted.
- **Encryption,** probably. The backup target may be a third-party store.
- **An existing system,** not a bespoke backup format.

### Candidates to compare

- **restic** or **kopia**: encrypted, deduplicated snapshots to local disk,
  S3-compatible stores, B2, SFTP, or anything rclone reaches. One binary;
  restore without beebox. Needs an include/exclude list and a key the
  boxholder keeps.
- **borg**: the same model; needs borg on the target too (or a host such as
  BorgBase).
- **git-annex special remote** with encryption (`encryption=hybrid`), plus a
  git remote for history (optionally `git-remote-gcrypt`). It uses the
  mechanism boxes already have and raises `numcopies` honestly. It covers
  only what git and annex track, and the boxholder needs two remotes.

### Questions for the design

- What is "box data" exactly: list each path under a box and state back up,
  rebuild, or leave out. Include state outside the box directory (the secret
  store, auth files).
- Who runs it: a box schedule, the hub, or the host (cron, NAS snapshot
  task)? What does Admin's Backup section show when it is on?
- Where does the key live, and how does the boxholder restore it on a new
  machine? A lost key is a lost backup.
- What does a restore look like, and how is it tested (a restore into a
  throwaway box on a schedule)?

## Research 2026-10-25

The [portable encrypted backup comparison](../../../research/box-backups/2026-10-25-portable-encrypted-backup.md)
inventories box, runtime, and external state and recommends restic as the
common snapshot engine, pending a consistency and restore design. The
post-isolation production boxes are on `/var/lib/beebox`, a separate volume
excluded from Hetzner server snapshots (`beebox/docs/server/provisioning.md`);
an optional Git remote still does not carry annex bytes or ignored state.
Decisions needed before planning: destination guidance, recovery-key handoff,
retention, and whether the initial restore flow needs single-file UI recovery.
