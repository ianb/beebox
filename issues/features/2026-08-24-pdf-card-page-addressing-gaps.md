---
title: "pdf.card Original view assumes PDF; page matcher untested on real docling output"
workstream: unattached
area: beebox
needs: [design]
labels: [ui, pdf, renderers]
filed-by: agent
discovered-in: document-card-view worktree — building the pdf.card view
---

Trimmed 2026-08-24: the first two gaps are built — `lib/docling.ts` parses
`docling.json.gz` (structured viewer + raw toggle), gutter `p. N` markers map
body blocks to pages via a two-pointer matcher, and `/card/` now forwards
`?page=`/`?view=`. Remainders:

## Original view assumes PDF

The "Original" renderer toggle points `PdfFrame` at `filename.ref`. For a
future non-PDF `format:` it degrades to the object-tag fallback
(Open/Download) — acceptable, not a viewer.

## Matcher untested against real docling output

The block→page matcher (`lib/docling-match.ts`, `MATCH_LOOKAHEAD = 8`) and the
figure-index correlation (`pictures[i]` → `figure-{i+1}.avif`, an ordering
convention from `pdf-extract.ts`, not a recorded link) are verified only
against synthetic fixtures. Run `bbx pdf reanalyze` on a real multi-page scan
and check the markers before trusting them on long documents.
