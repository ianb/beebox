---
title: "The 2026-08-30 rename damaged binary files that are still in the tree"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — B-inventory journey walk, 2026-10-08
resolution: implemented
---

Resolved in the journey-walks-oct workstream: both icons and the field-test JPEG
restored from their pre-rename blobs; `beebox/test/webapp/routes/box-identity-assets.png-checksums.doctest.md`
now checks the chunk checksums of every tracked PNG under `beebox/`, and fails
on the damaged icon.

Commit `dab834811` (the 2026-08-30 product rename) replaced the old two-letter
CLI token with "bbx" across the repo, including inside binary files. Two
shipped PNGs now fail their PNG chunk checksums:

- `beebox/src/frontend/public/icons/icon-192.png` (52679 bytes; the original
  was 52678)
- `beebox/src/frontend/public/icons/icon-512.png` (329640 bytes; the original
  was 329630)

Both have a bad `IDAT` chunk. The originals are intact:
`git show dab834811 --raw -M` lists the pre-rename blobs `bad4103bf` and
`2b1d6bb67`, and both pass the checksum test. The icons are served as the
app icons (`beebox/src/frontend/index.html`,
`beebox/src/webapp/routes/box-identity-assets.ts`,
`beebox/src/core/send-push.ts`). A browser may still decode them or may show a
broken icon. `apple-touch-icon.png` is identical to the original (`R100`).

Commit `e7b35ee2e` restored the audio files the rename damaged, and
`c2ef0e299` restored the two B-inventory journey photos. The B-inventory walk
found the damage because its walker saw the photos as corrupt
([report](../../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-08.md),
rows 19 and R4). The PNGs above were missed by both fixes.

## One more file

`beebox/field-tests/onboarding-first-days/assets/wren-soccer-schedule.jpg` is
one byte longer than its pre-rename blob (`322689d99`) but still decodes, per
the report. It changed content all the same.

## Fix

Restore the PNGs from the old blobs
(`git show bad4103bf > beebox/src/frontend/public/icons/icon-192.png`, and
likewise `2b1d6bb67` for `icon-512.png`). Restore the JPEG the same way.
Then add a check, for example a doctest over `beebox/src/frontend/public/`
that decodes each PNG and checks its chunk checksums, so a text replace over
binaries fails loudly. The `e7b35ee2e` precommit change only skips binaries
in the shell-file scan and is no such guard.
