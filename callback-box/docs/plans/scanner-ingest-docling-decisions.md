# Docling Decisions Log — scanner-ingest

Running log of every Docling-related choice made during implementation, for
boxholder review. Docling is a big surface with many ways to use it; these
are first choices made in the ingest context, all revisitable —
`cb document reanalyze` exists precisely so extraction can be re-run after a
decision changes. Parent plan: [`scanner-ingest.md`](scanner-ingest.md).

Format: decision, why, what revisiting would look like. Implementation
appends as it goes.

## D1. `do_ocr=False` — trust the scanner's text layer

Docling has no hybrid mode (open upstream request); force-OCR discards the
existing layer and has a long-document bug. ScanSnap's OCR is the text
source; Docling contributes layout/reading-order/tables. **Revisit:** if
ScanSnap text quality disappoints, flip default or per-box config; reanalyze
affected cards with `--force-ocr`.

## D2. Invocation: `uvx docling` CLI per document, not docling-serve

No resident service to operate/monitor; uv caches one environment; scanner
volume makes per-invocation startup acceptable. **Revisit:** if latency or
throughput matters, docling-serve behind the same wrapper interface.

(further decisions appended during implementation)
