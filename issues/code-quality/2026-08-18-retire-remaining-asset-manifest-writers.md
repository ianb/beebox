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

Every production box is now annex-shaped, with zero asset manifests, a clean
tree, and a quiet `annex fsck --fast`. Four boxes were converted in this pass
(133 assets, ~494 MB); two were already at zero.

Three things blocked it, none of them the conversion itself:

- **16 agent-written `manifest.json` files** — the collision this issue's
  Observed cost section named. A box agent wrote them while filing property
  photos, with its own `{filename, captured, source}` schema, and `to-annex`
  read them as corrupt asset manifests and refused rather than blessing
  unverified state. Nothing referenced them; removed on the boxholder's call.
- **A live box's uncommitted tree** — an unrecorded migration and a
  just-arrived scan. Cleared by the boxholder, not around them.
- **17 path-anchored asset ignore rules** on one box, left by the one-root
  migration copying a v2 box's `.gitignore` verbatim. See below.

## The ignore-rule blind spot (fixed)

`isAssetIgnoreRule` matched only `**/*.attach/**/*.<ext>`, so the anchored
spelling `/_content/**/*.attach/**/*.<ext>` was invisible to it. Both hide the
same files from `git add`, and both of that predicate's callers failed open:
`unignore` found no stray rules and reported success, `to-annex` converted and
reported success, and `gitignoreIgnoresAssets` told the annex-shape probe the
box was converted. The box sat in exactly the state `core/annex/is-annex-box.ts`
describes in its own doc comment — every asset ignored, reaching neither git nor
the annex, nothing reporting it — while every tool called it healthy.

It surfaced only because the fleet was checked with `git check-ignore` per box
instead of by asking the probe. That is the check to use; `.git/annex/` existing
answers a different question, and so does the count of tracked manifests.

The matcher now keys on the pattern's distinctive middle. The repaired box's 536
previously-hidden assets (3.4 MB, mostly page snapshots) are committed and
annexed; they had never been recorded anywhere.

## What retirement still needs

The box-side blockers are gone. What remains is the capture question above: on
an annex box, capture staging media is deliberately ignored until an agent files
it, so the manifest is its only record in that window. Deleting
`asset-manifest.ts` + `asset-manifest-scan.ts` needs an answer there, plus the
readers in `annex/to-annex.ts` and `commands/attachments-gitignore.ts` retired
with them. Bulk upload's writer is now redundant on every box and can go once
capture is settled.

## A NEW box is not annex-shaped (2026-09-11)

Checked while surveying this issue for deletion, and it changes the "redundant
on every box" claim above: redundancy holds for the boxes that exist, not for
the ones `bbx init` creates. `writeBoxGitignore` picks its block from
`isAnnexInitialized` (`core/box/index.ts:135`, used at `:281`), so a box
created in a repo without annex gets `GITIGNORE_BLOCK` — assets ignored — and
nothing in the creation path runs `git annex init` (the only `annex.init()`
caller is `annex/to-annex.ts`, i.e. an explicit conversion). On such a box the
bulk-upload manifest is again the only record of an uploaded blob, exactly as
it was on the last un-converted box.

So removing bulk upload's writer needs the same `isAnnexBox` gate the section
above proposes for the manifest-shaped case — which keeps the manifest code
alive either way, for little gain while capture is unsettled. The honest
sequence is: settle capture, or make new boxes annex-shaped at creation, and
only then delete. Issue stays open.
