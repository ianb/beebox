---
title: Photo-batch uploads bypass git-annex (raw blobs + manifest-scheme files post-conversion)
workstream: annex-bypass-check
priority: important
resolution: wontfix
---

**Closed 2026-08-18 — the annex-bypass premise does not hold.** Photo batches
annex correctly, and did so from the first post-conversion batch onward. The two
findings that survived the investigation are split out as their own items:
[retire the remaining asset-manifest writers](../../code-quality/2026-08-18-retire-remaining-asset-manifest-writers.md)
and [stale `annex.largefiles` never re-applies](../../bugs/2026-08-18-stale-annex-largefiles-never-reapplies.md).

## What was checked, and how (2026-08-18)

**1. A batch prepared today annexes.** `prepareBulkBatch` was driven against a
real annex box (`annex.version 10`, current `cb doctor annex` clean) with a 3 MB
JPEG. The committed git object is a 102-byte `/annex/objects/SHA256E-s3145728--…`
pointer, not the bytes. Reproduction: stage a bulk session, call
`prepareBulkBatch`, then `git cat-file -s HEAD:<attachRelDir>/<name>.jpg`.

**2. Production agrees, including the batch the issue was filed about.** All
three post-conversion batch commits on the box in question (2026-07-31 23:50,
2026-08-01 00:35, 2026-08-01 17:31) committed every photo as a ~103-byte
pointer. A full census of that box's `HEAD` finds 1,420 asset pointers and zero
raw image or video blobs. A sweep of every commit on every ref since 2026-07-30
finds exactly one raw asset object added — a rename of a PDF that was already a
raw blob before the conversion, not a new one.

**3. The timing hypothesis is moot.** It was the distinguishing test between the
two hypotheses, but the earliest post-conversion batch already committed
pointers, so there was never a window to date.

**Most likely origin of the original report:** the *working tree*, not the
committed object. Under annex v10 with the smudge filter, a delivered batch's
attach directory holds the real JPEG bytes at mode 100644 — that is the annex
working correctly, and it looks exactly like a raw blob to `file` or `xxd`.
`git cat-file -p HEAD:<path>` is the check that tells them apart.

## What would make this wrong

A raw asset blob appearing in a *new* commit. The census command above is cheap
to re-run. The one live path by which that could still happen is the stale
`annex.largefiles` issue linked at the top: it does not affect bulk batches
(their batch-local `.gitattributes` sets `* annex.largefiles=anything`), but it
does affect assets written anywhere else on a box that has not had
`cb doctor annex` re-run since 2026-08-05.

## Disposed of separately

- **Old-scheme asset manifests are still written** — confirmed, and the only
  code defect the issue named that is still true. Split out to
  [retire the remaining asset-manifest writers](../../code-quality/2026-08-18-retire-remaining-asset-manifest-writers.md).
- **The `manifest.json` name collision** — confirmed in production: 62 files of
  the asset-manifest shape (`files`/`size`/`mtime`) and 16 of the
  `filename`/`captured`/`source` shape. The second shape is **not written by our
  code**. A box agent invented it while filing photos out of a delivered batch.
  Nothing to rename; the collision disappears when the asset manifests do.
- **Historical raw blobs** — 44 raw asset objects (17.2 MB) remain in one box's
  `HEAD`, all committed 2026-07-04, all outside `.attach/` scopes. The migration
  did not miss them: `docs/plans/asset-annex.md` "NOT in scope" excludes
  annexing anything outside `.attach/`. No history rewrite is proposed.
