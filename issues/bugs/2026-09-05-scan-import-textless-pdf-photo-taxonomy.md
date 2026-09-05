---
title: A scanned document with no text layer gets photo/back/blank triage, and its unclassifiable pages are offered "photo, back-of-photo, or trash"
workstream: unknown
priority: backlog
---

`scan-import` dispatches a single PDF on one bit — whether it carries an
embedded text layer (`src/core/commands/scan-import.ts:100-109`):

- text layer present → pdf mode (Docling extraction)
- no text layer → the photo flow, pages rendered with `pdftoppm`

The second branch is deliberate: the plan's prior-art notes reject Docling's
own OCR as weak on messy material and route such input to the vision flow
instead (`docs/plans/scanner-ingest.md`). That reasoning holds for the
*OCR* — the vision pass reads pages well, sets `has-text`, and writes an
accurate transcription and description.

The problem is the **taxonomy applied after the OCR**. The photo flow must
label every page `photo | back | blank | unsure`. A document page is none of
those, so the model correctly declines to classify it — observed verbatim in
its own memo: *"not a photograph or photo-back — doesn't fit the
photo/back/blank taxonomy"*. Each such page becomes an `unsure` question:

    prompt:    What is unsure-001.jpg? (photo, back-of-photo, or trash)
    directive: If a photo, create an image card. If a back, attach to the
               relevant photo card. Otherwise delete <path>.

For a scanned document that question has no correct answer on the menu, and
the fallback directive is *delete the page*. Nothing is lost today — the
source PDF is filed intact and the pages become pending questions rather than
content — but a batch of documents scanned without OCR yields one
unanswerable question per page, and the only offered disposition for a page
that is neither photo nor back is destruction.

Observed rate on a real batch: 9 pages across 4 PDFs produced 2 image cards
and 7 `unsure` questions.

Two things worth separating in any fix:

1. The dispatcher has only two destinations, so "document" and "photo album"
   are decided by whether OCR happened to be enabled at the scanner — not by
   what the material is. A folder can be designated for documents (a box's
   scan guide card can even say so, and those priors demonstrably reach the
   vision pass) and still land in the photo branch.
2. The photo flow's question vocabulary is photo-specific. Even if a document
   correctly lands there, `photo | back | trash` is the wrong set of choices
   and "delete" is the wrong default for the leftover case.

A plausible direction is a third branch: textless PDF → OCR by vision as
today, but emit document-shaped cards and document-shaped questions. Filed as
a tension, not a settled design — the OCR-engine choice in the original plan
is not what's being questioned here, only what happens to the result.
