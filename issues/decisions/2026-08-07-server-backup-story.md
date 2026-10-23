---
title: "No automated backup story for server box data"
workstream: security-report
area: beebox
filed-by: agent
discovered-in: worktree-security-report — operational inventory for the security report
priority: normal
---

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
