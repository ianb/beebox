---
title: "Image card EXIF date extraction"
workstream: unknown
area: beebox
priority: backlog
---

When processing image cards, prefer the date from EXIF `DateTimeOriginal` over file timestamps. File mtime/ctime are unreliable after syncing/copying (common with photo workflows) — EXIF is the source of truth for when the photo was taken.

## Audit 2026-10-22

Partly done. The image schema has an `exif:` field and tells the analyzing agent to put the camera's original timestamp in `exif.date` (`beebox/src/schemas/image/schema.tsx:105` and `:143-145`). No code reads EXIF `DateTimeOriginal` from the file, and nothing makes processing prefer `exif.date` over file timestamps. The only EXIF code reads orientation (`beebox/src/shared/image-orientation.ts`). The remaining work is a deterministic extractor plus the preference rule.
