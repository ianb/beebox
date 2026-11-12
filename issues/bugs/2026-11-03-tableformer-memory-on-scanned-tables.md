---
title: "TableFormer adds about 1 GB of peak memory on scanned table pages"
workstream: unattached
area: beebox
labels: [pdf, docling, memory]
filed-by: agent
discovered-by: agent
discovered-in: "docling-memory workstream, 2026-11-03"
---

A ten-page degraded scan of table-heavy government report pages (image-only,
200 dpi) peaks at about 1.8 GB through the Docling driver
(`src/services/docling/convert.py`) with OCR `regions`. With OCR off it still
peaks at 1,622 MB; with table structure off as well, 660 MB. The same kind of
pages as a digital PDF peak at about 1.1 GB with tables on (D18 in
`beebox/docs/plans/scanner-ingest-docling-decisions.md`). So on image-only
table pages TableFormer costs about 960 MB, against about 370 MB on digital
ones.

Beside a box server and chat (about 550 MB), a 1.8 GB conversion passes the
box's 2 GiB `MemoryHigh` and is throttled; the 2560M `MemoryMax` is close.

Not yet known: whether the cost is per table (large or many cells without text
cells to match) or per page, and whether `table_batch_size` 1 is honoured on
this path. A first step is a stage profile of one scanned table page with
`do_cell_matching` on and off. Turning table structure off is not a fix: these
documents are mostly tables.
