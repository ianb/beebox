---
title: cb doctor annex passes on a box the scan annex gate refuses (gitignore half unchecked)
---

`isAnnexBox` (`src/core/annex/is-annex-box.ts`) gates on TWO conditions:
annex initialized AND the box `.gitignore` no longer carrying the
manifest-scheme asset-ignore block. `cb doctor annex --check` verifies
seven things (binary, initialized, thin, largefiles, content-present,
journal, hook) — but not the gitignore half.

Hit for real 2026-08-02: a prod box passed doctor 7/7 while the scan-upload
routes answered 503 `box is not annex-converted` — its `.gitignore` still
had the `**/*.attach/**` ignore block (the documented older-`cb init`
regression the module comment describes). The diagnostic said healthy; the
gate said no; reconciling them took reading the probe source.

Fix: doctor grows an eighth check mirroring `gitignoreIgnoresAssets` (and
ideally suggests the repair: remove the managed block, add the post-annex
unignore block). A gate and its diagnostic disagreeing is exactly what
doctor exists to prevent.
