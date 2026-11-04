---
title: "RapidOCR's text detector adds about 900 MB at its peak on a scanned PDF"
workstream: docling-memory
area: beebox
labels: [pdf, docling, ocr, memory]
filed-by: agent
discovered-by: agent
discovered-in: "docling-memory workstream, 2026-11-03"
resolution: implemented
---

**Closed (implemented, 2026-11-03):** D20: RapidOCR max side 1280 px; the remaining scan cost is TableFormer, filed as 2026-11-03-tableformer-memory-on-scanned-tables

After the Docling memory changes (D18 in
`beebox/docs/plans/scanner-ingest-docling-decisions.md`), a digital PDF of any
length peaks at about 1.0-1.1 GB. A 16-page 200-dpi scan converted with OCR
`regions` (every textless PDF, `src/core/pdf/write-card.ts:31`) still peaks at
about 1.56 GB, measured in a Linux cgroup. Memory retained after conversion is
about 820 MB; the rest is a transient spike while RapidOCR runs, with or
without table structure.

Likely cause, not yet confirmed by a profile of the detector alone: Docling
renders OCR crops at 3x (216 dpi), and RapidOCR's detector config has
`limit_side_len: 736` with `limit_type: min`, which only enlarges small inputs
and never shrinks a large page. The detector's feature maps then scale with
the full page area.

Possible directions, each a change to OCR output that needs a quality
comparison first (D7 and D15 record how the current modes were scored):

- `limit_type: max` with a side limit near 1,280-2,000 px, passed through
  Docling's `rapidocr_params`.
- A lower OCR render scale.

At 1.56 GB beside a box server and chat (about 550 MB) a scan conversion
reaches about 2.1 GB, slightly over the box's 2 GiB `MemoryHigh`: the box is
throttled for the length of the OCR, not killed.

## Findings (2026-11-03)

Measured and fixed in D20 (`beebox/docs/plans/scanner-ingest-docling-decisions.md`).
RapidOCR already caps its input at 2000 px a side (`Global.max_side_len`), so
the hypothesis above was only partly right. Lowering the cap to 1280 px cut the
real scan's peak from 1,562 MB to 1,406 MB and its time by half, and improved
OCR on degraded scans with known text (fewer run-together words, higher
recall). The larger remaining cost on table-heavy scans is TableFormer, not
OCR: `2026-11-03-tableformer-memory-on-scanned-tables.md`.
