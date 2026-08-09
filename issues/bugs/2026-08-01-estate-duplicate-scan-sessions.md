---
title: Estate box holds three duplicate scan sessions of one photo pair
workstream: unknown
---

Found while sampling the estate box for the scanner model-comparison
experiment (2026-08-01): three `scan-*` capture sessions in the estate box
inbox hold byte-identical copies of the same photo front/back pair (md5
`4aba0a9f…` / `9bdbc9db…`). They present as three separate scans but are one.

Two angles: (a) data repair on the estate box — collapse to one session
(check prod vs local backup state first); (b) whether the capture/scan
ingest path that created them should have deduped — the new scan-upload
pipeline dedups by content hash, but the older gallery/capture path that
produced these evidently did not.
