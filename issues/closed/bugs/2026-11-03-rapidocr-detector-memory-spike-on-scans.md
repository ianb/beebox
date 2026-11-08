---
title: "RapidOCR's text detector adds about 900 MB at its peak on a scanned PDF"
workstream: docling-memory
area: beebox
labels: [pdf, docling, ocr, memory]
filed-by: agent
discovered-by: agent
discovered-in: "docling-memory workstream, 2026-11-03"
resolution: wontfix
---

**Closed (wontfix, 2026-11-08):** Boxholder decision 2026-11-08: the remaining memory gain from a lower OCR cap (about 1.6 to 1.34 GB on a 16-page scan) is not worth the table-recall loss; the detector fix in D20 stays. TableFormer cost is tracked in 2026-11-03-tableformer-memory-on-scanned-tables.

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

D20 in `beebox/docs/plans/scanner-ingest-docling-decisions.md` has the method
and numbers. RapidOCR already caps every input at 2000 px a side
(`Global.max_side_len`), so the hypothesis above was wrong. What the detector
did do: `limit_type: min` enlarged every region until its short side was
736 px, so a full-width one-line region was detected at about 46,000 x 736 px.
The driver now caps the detector's long side at 2000 instead
(`Det.limit_type: max`). OCR output is unchanged within noise; a degraded
prose scan dropped from 1,634 MB to 1,226 MB and OCR runs about 20% faster.

Still open: on the real 16-page scan the peak stays near 1.6 GB. There the
cost is the detector on large full-page regions at up to 2000 px. A detector
cap of 1280 brought that scan to 1,342 MB but lost table recall (0.921 to
0.900 on a degraded table scan). Lowering RapidOCR's global cap to 1280 kept
quality on letter-size scans but fails on thin full-width regions (they
resize to zero height and raise) and reads large-format pages at about 75 dpi.
So the next step is a boxholder call on memory versus table recall, or a
detector cap that applies only to full-page regions.

The larger cost on table-heavy scans is TableFormer:
`2026-11-03-tableformer-memory-on-scanned-tables.md`.
