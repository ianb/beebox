---
title: Asset-manifest writers still run after the annex migration retired the scheme
workstream: unattached
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

**What's unresolved.** Whether retirement means deleting `asset-manifest.ts` +
`asset-manifest-scan.ts` (the plan's stated intent, ~490 lines) or just stopping
the writers first, and whether existing manifests get removed from boxes as a
migration or left as inert files. Also worth checking what still reads them —
`to-annex.ts:50` uses `loadManifest` for its verification step, which is the
migration's own tooling and may want to stay until every box has converted.

Doc drift to fix alongside: `test/core/bulk-upload/prepare.doctest.md` still says
"blobs stay out of git" and titles a section "blobs untracked", while the
assertion below it correctly expects `blobTracked: true`.
