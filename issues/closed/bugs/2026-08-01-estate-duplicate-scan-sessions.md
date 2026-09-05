---
title: Estate box holds three duplicate scan sessions of one photo pair
workstream: unknown
priority: backlog
resolution: implemented
---

> Closed 2026-09-05: data repaired on the live box — the two unfiled inbox copies were removed (box commit `619c1c3f`), leaving the one filed archive copy; the only other references were a historical procedure-run record and regenerated indexes. The ingest half was already covered by content-hash dedup in the current scan upload. Doing this surfaced a separate bug: the one-root migration's root `.bbx-maps-ignore` was outside the closed root vocabulary, so the box's pre-commit refused every commit (fixed in `f036c06b3`).

> `invalid?` checked 2026-09-05: not invalid, half done. The mechanism half is answered — the current ingest (`scan-upload.ts`) dedups by sha256 and reports `duplicate`; the gap was the older path. The data-repair half is untouched: the three sessions with matching md5s are still in the backup copy. That repair is real-box data and the boxholder's call.

Found while sampling the estate box for the scanner model-comparison
experiment (2026-08-01): three `scan-*` capture sessions in the estate box
inbox hold byte-identical copies of the same photo front/back pair (md5
`4aba0a9f…` / `9bdbc9db…`). They present as three separate scans but are one.

Two angles: (a) data repair on the estate box — collapse to one session
(check prod vs local backup state first); (b) whether the capture/scan
ingest path that created them should have deduped — the new scan-upload
pipeline dedups by content hash, but the older gallery/capture path that
produced these evidently did not.
