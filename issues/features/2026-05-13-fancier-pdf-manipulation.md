---
title: "Fancier PDF manipulation"
workstream: unknown
area: beebox
---

> `reconfirm?` checked 2026-09-05: still live. The Docling pipeline (`pdf-extract.ts`) does layout-aware extraction, but form-field detection (`commonforms`) was never evaluated.

If we ever want richer PDF handling than scan-import currently does — form-field detection, structured extraction, layout-aware parsing — `commonforms` looks worth a look.

- <https://github.com/jbarrow/commonforms>
- HN discussion: <https://news.ycombinator.com/item?id=47984675>

Re-reviewed 2026-10-30: still not evaluated; the Docling pointer pdf-extract.ts is now beebox/src/core/pdf/extract.ts.
