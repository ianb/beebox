---
title: Asset-manifest writers still run after the annex migration retired the scheme
workstream: transition-cleanup
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-annex-bypass-check — investigating the photo-batch annex-bypass report
priority: important
---

`docs/plans/asset-annex.md` retires the asset-manifest system: *"**Retired**,
not reused. git-annex's key (`SHA256E-s<size>--<hash>`) carries the same
information git-annex itself maintains, so keeping both is exactly the
duplication #8 forbids."* Two live code paths still write `manifest.json` in the
retired format.

- `beebox/src/core/bulk-upload/prepare.ts:235` — every bulk batch writes an
  asset manifest into its attach scope and commits it. The batch-local
  `.gitattributes` even carries a `manifest.json annex.largefiles=nothing` line
  to keep it out of the annex.
- `beebox/src/core/capture/write-cards.ts:71` — every capture child card
  gets a per-scope manifest, staged at `:72`.
- `beebox/src/core/commands/attachments.ts:263,302` — `bbx attachments`
  still maintains manifests.

The result is a size + sha256 record sitting beside an annex key that already
holds the same size and hash. It is duplication, not corruption: nothing reads
the manifests to make a decision that annex does not make better.

**Observed cost.** On one production box, 62 asset manifests are tracked at
`HEAD`. They also created a name collision that made an unrelated investigation
harder: a box agent independently wrote 16 files also named `manifest.json` with
a different schema (`filename`/`captured`/`source`) while filing photos, and the
two are only distinguishable by opening them.

## Done: the automatic writers

`core/bulk-upload/prepare.ts` and `core/capture/write-cards.ts` no longer write
a manifest. Capture had to change what it stages, not merely stop writing: it
staged the manifest and never the media, so removing the manifest without
staging the bytes would have committed a card describing content in no
repository — the exact trap `prepare.ts` documents at its own staging call. It
now stages the media, and git-annex takes it. The batch-local `.gitattributes`
drops its `manifest.json annex.largefiles=nothing` exemption.

The doc drift this issue named is gone, as is the doctest prose about the
manifest recording each blob's size and sha256.

## Still open, and why

**`bbx attachments` is left intact.** Its `migrate`, `add`, and `overwrite`
subcommands do write manifests, but they are the maintenance surface for a box
that has NOT converted, and on the production machine two boxes have not (each
holding several dozen tracked manifests, against 0-1 on the rest). Removing the
maintenance commands before those boxes convert would strand them: an asset
written without its manifest updated fails `to-annex`'s pre-conversion
verification, which is the check that makes deleting the manifests safe rather
than merely tidy.

**Deleting `asset-manifest.ts` + `asset-manifest-scan.ts` is blocked on those
same boxes.** `annex/to-annex.ts` reads manifests for both halves of its
verification, and `commands/attachments-gitignore.ts` reads them too.

So the remaining work is: run `bbx attachments to-annex` on the two unconverted
production boxes, then delete the modules and the manifest subcommands with
nothing left reading them.

**The conversion is blocked on the boxes' working trees.** `to-annex` refuses
on a dirty tree, and both are dirty — one with eight entries, the other with
twenty-one, including a set of uncommitted deletions that look like a
capture-archive move someone started and never committed. Both boxes commit
regularly (last commits within the hour when this was checked, 2026-09-06), so
the residue is not a stalled box; it is ordinary live-box working state several
hours old. Clearing it means committing the boxholder's own uncommitted box
content, which is theirs to do, not an agent's — and one of the two holds
personal material. The conversion runs once the boxholder has settled those
trees.
