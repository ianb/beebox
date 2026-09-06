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

## Attempted, reverted: the premise is wrong for both writers

Both writers were removed and the removal was reverted. The claim above —
"nothing reads the manifests to make a decision that annex does not make
better" — does not hold for either path, and the check that establishes it is
`git check-ignore`, run against real boxes rather than reasoned about.

**Capture staging media is deliberately never annexed on arrival.** The
annex-converted gitignore block says why: a capture is pre-triage and gets
renamed, re-encoded, and EXIF-rotated before it is filed, so annexing it on
arrival would mint objects for superseded versions; it joins the annex when an
agent files it (`core/commands/attachments-gitignore.ts`, `UNIGNORE_BLOCK`).
The re-include list under `tmp-capture/` admits exactly directories, `*.card`,
`manifest.json`, and `*.timing.json`. So on an annex box the manifest is the
ONLY record of a capture's media between the commit and the filing, and
`git check-ignore` confirms the media itself is ignored on every production box.
Deleting the writer there does not remove a duplicate record; it removes the
only one. Staging the media instead does not work either — it is ignored, so
`git add` skips it silently, and the existing doctest already asserts
`git ls-files` over a capture attach scope is empty.

**One production box is still manifest-shaped.** Five of six have assets
un-ignored (annex takes them); one still ignores `.attach/` assets, so for that
box the bulk-upload manifest is likewise the only record of an uploaded blob.
Annex-shape is per box and has to be checked per box; the count of tracked
manifests is not the same question, and `.git/annex/` existing answers neither
— `git check-ignore` on an `.attach/` asset is the check that does.

## What retirement would actually take

- **Bulk upload:** gate on annex shape (`core/annex/is-annex-box.ts`) and write
  a manifest only for a manifest-shaped box, or convert the last box first.
  Straightforward once the shape check is in the path.
- **Capture:** a design question, not a cleanup. Something has to record a
  staged capture's media between commit and filing, or the window has to be
  accepted as unrecorded. Annex deliberately does not cover it.
- **Deleting `asset-manifest.ts` + `asset-manifest-scan.ts`** stays blocked on
  the readers in `annex/to-annex.ts` (both halves of its verification) and
  `commands/attachments-gitignore.ts`, and on the capture question above.

## Conversion progress (2026-09-06)

One of the two boxes carrying manifests converted cleanly: `to-annex` annexed
70 assets (210 MB) and removed all 70 manifests, leaving the tree clean and
`annex fsck --fast` quiet. Four other boxes were already at zero.

Two boxes still stand between here and deleting the modules:

- The remaining manifest-carrying box (78) has an uncommitted regenerated
  `.agents/skills/…/SKILL.md` from a `landmark-symbol` migration that box never
  recorded, plus freshly arrived scan content. `to-annex` refuses on a dirty
  tree, and committing a half-applied migration or someone's just-arrived scan
  is the boxholder's call. It needs the migration finished and the scan handled,
  then the conversion runs.
- The manifest-shaped box (0 manifests, but assets still gitignored) is a
  different problem: nothing to convert, but it is where bulk upload's manifest
  is still the only record of a blob. It needs `bbx attachments unignore` plus a
  conversion, or the shape gate above.

A third thing worth fixing whatever the outcome: `SessionBuilder.filesToStage`
(`core/capture/write-cards.ts`) is written and never read — `writeCaptureDocument`
does not return it, and `core/capture/prepare.ts` commits a directory pathspec
instead. An array that looks like it controls staging and does not is how the
attempt above went unnoticed through a green suite.

## Doc drift, fixed

`test/core/bulk-upload/prepare.doctest.md` no longer says "blobs stay out of
git" or titles a section "blobs untracked".
