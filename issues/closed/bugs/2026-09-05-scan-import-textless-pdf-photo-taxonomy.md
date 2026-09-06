---
title: A scanner OCR setting decides which pipeline a scan takes — textless PDFs are treated as photo batches, not documents
workstream: scanner-setup
priority: backlog
resolution: implemented
---

Resolved by `01d934919` (`scan-import: a scanned PDF is a document, whether or
not OCR was on`, `beebox/src/core/commands/scan-import.ts`,
`beebox/src/core/commands/scan-import-pdf.ts`), diverging from this issue's own
sketch of the fix: instead of routing textless PDFs through vision OCR into a
document-shaped card, a single PDF now always goes to pdf mode and Docling
itself force-OCRs when the text-layer probe finds nothing to read (leaving an
existing layer alone). The text-layer probe decides only how to get the text,
not which pipeline the PDF takes. The photo flow keeps an explicit `mode:
photos` escape hatch for scanned photo albums. That closes the dispatch
tension and the missing-destination tension below; the photo flow's `photo |
back | trash` vocabulary no longer applies to document pages because they
never reach it.

`scan-import` dispatches a single PDF on one bit — whether it carries an
embedded text layer (`src/core/commands/scan-import.ts:99-111`):

- text layer present → pdf mode (Docling extraction, `source.pdf.card`)
- no text layer → the photo flow, pages rendered with `pdftoppm`

The code states the assumption behind the second branch outright: *"a PDF
without one is a photo batch that happens to be wrapped in a PDF, and belongs
in the photo flow where front/back pairing lives."* That held when the only
textless PDFs came from scanning photo albums. It is false as soon as a
document scanner writes image-only PDFs — which is the default on at least
some ScanSnap profiles, where "searchable PDF" (embed an OCR text layer) is a
setting the operator has to find and enable.

**The defect is the conflation, not the taxonomy alone.** One bit currently
decides two independent questions:

1. *What is this material* — a document, or a batch of photographs? This
   should determine the card shape and the question vocabulary.
2. *Does it already carry text* — i.e. read the embedded layer, or OCR it?

Only (2) is something the text-layer probe actually knows. Today (2) silently
answers (1), so a scanner checkbox decides which pipeline a document takes.
The same conflation misroutes in the other direction: photographs scanned on a
profile with OCR enabled can pick up a text layer and land in pdf mode.

Downstream, the photo flow must label every page `photo | back | blank |
unsure`. A document page is none of those, so the vision pass correctly
declines to classify it — observed verbatim in its own memo: *"not a
photograph or photo-back — doesn't fit the photo/back/blank taxonomy"*. Each
such page becomes a question whose choices are wrong:

    prompt:    What is unsure-001.jpg? (photo, back-of-photo, or trash)
    directive: If a photo, create an image card. If a back, attach to the
               relevant photo card. Otherwise delete <path>.

For a scanned document no answer on that menu is correct, and the fallback
directive is *delete the page*. Nothing is lost today — the source PDF is
filed intact and the pages become pending questions rather than content — but
a batch of documents scanned without OCR yields one unanswerable question per
page, and the only offered disposition for a page that is neither photo nor
back is destruction.

Observed on one real batch: 9 pages across 4 PDFs produced 2 image cards and 7
`unsure` questions. The same scanner with "searchable PDF" enabled produced a
clean `source.pdf.card` with Docling structure, page renders, extracted
figures, and zero questions — same scanner, same documents, different setting.

Worth separating in any fix:

- **The dispatch criterion.** Document-vs-photographs should come from the
  material (classification) or from declared intent (the uploader knows which
  folder a scan came from; a box's scan guide card can say what it holds), not
  from whether OCR happened to be on. Text-layer presence should only decide
  how to *get* the text.
- **The missing destination.** There is currently no way to produce a document
  card from a textless PDF. The original plan deliberately rejected Docling's
  own OCR as weak on messy material and routed such input to the vision pass —
  and the vision OCR is good (it transcribed a dense form page accurately). So
  the gap is not OCR quality; it is that the vision path can only emit photo
  cards. A textless document needs vision OCR with a document-shaped output.
- **The question vocabulary.** Even when material correctly lands in the photo
  flow, `photo | back | trash` with delete-as-fallback is the wrong choice set
  for anything that isn't a photograph.

Filed as a tension, not a settled design. The OCR-engine choice in the
original plan is not what's in question — only what decides the path, and what
the result can be shaped into.
