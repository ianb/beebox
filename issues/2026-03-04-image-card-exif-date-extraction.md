---
area: callback-box
---

# Image card EXIF date extraction

When processing image cards, prefer the date from EXIF `DateTimeOriginal` over file timestamps. File mtime/ctime are unreliable after syncing/copying (common with photo workflows) — EXIF is the source of truth for when the photo was taken.
