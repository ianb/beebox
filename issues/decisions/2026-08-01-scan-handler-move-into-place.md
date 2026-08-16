---
title: Scan triage handler — move-into-place procedure or accept manual moves?
workstream: unknown
---

The destination-role landmark cards installed on the scanning boxes
(2026-08-01) carry `destinations:` rules but no `procedure:`. Per
`docs/triage.md`, the handle stage needs a `procedure:` (inline or
`{ref: ...}`) on a destination to move a triaged item to its final resting
place. Without one, scanned documents triage into
`inbox/triaged/<category>/` and stop there.

Decision: accept the manual-move gap, or write one small shared
"move-into-place" procedure card the landmarks reference by `ref:`. Leaning
toward writing it — the manual step will get old fast once real scanning
starts (uploader go-live is the trigger point). One procedure serving all
categories via `ref:` fits the triage design's "let one procedure serve
multiple categories" option.
