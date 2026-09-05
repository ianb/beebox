---
title: Estate box holds three duplicate scan sessions of one photo pair
workstream: unknown
priority: backlog
---

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
