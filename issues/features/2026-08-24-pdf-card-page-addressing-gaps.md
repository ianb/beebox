---
title: "pdf.card view: no text↔page mapping, and ?page= works only in browse"
workstream: unattached
area: callback-box
needs: [design]
labels: [ui, pdf, renderers]
filed-by: agent
discovered-in: document-card-view worktree — building the pdf.card view
---

The pdf.card view (2026-08) shows the extracted text and a page-render
strip, but the two are unconnected, and page deep-links only work on one
route.

## Text↔page mapping needs `docling.json.gz`

The card body carries no page-boundary markers — the extractor passes no
page-break placeholder and adds none itself. The mapping exists only in
`attach/docling.json.gz` (`DoclingDocument`, per-text-item
`prov[].page_no`), which the codebase treats as opaque cargo: nothing
in-repo parses it. A "which page is this paragraph on" affordance — or
jumping from a quote anchor to the page render — means gunzipping and
walking that JSON in the frontend or via an endpoint. Decide whether that
is worth a helper before any second consumer appears.

## `?page=N` is browse-only

`BrowseDetailPanel` forwards query params to `FileView`, so
`/browse/...?page=2` highlights and scrolls the page strip. The full-page
card route (`/card/...`) forwards no search params, so the same link there
silently does nothing. Wiring it touches that route's search schema.

## Original view assumes PDF

The "Original" renderer toggle points `PdfFrame` at `filename.ref`. For a
future non-PDF `format:` it degrades to the object-tag fallback
(Open/Download) — acceptable, not a viewer.
