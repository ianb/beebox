---
title: A PDF's text layer is trusted without checking whether it is usable, and OCR settings are left at defaults that lose words
workstream: unknown
priority: backlog
---

Three findings from measuring the PDF extraction path against real scanned
documents. They compound: the first silently produces bad text, the other two
leave better text on the table.

## 1. A junk text layer is trusted over OCR that would do far better

`scan-import` treats "has a text layer" as "the text layer is the whole point"
and skips OCR (`src/core/commands/scan-import-pdf.ts`, `forceOcr:
!probe.hasTextLayer`). `pdf-probe.ts` only counts characters —
`TEXT_LAYER_MIN_CHARS = 64` — so it cannot tell a good layer from a useless
one.

Measured on one 8-page typewritten scan whose scanner embedded its own OCR:

    text layer (trusted today):  p o w e r f u l   a n d   r u l e d   most  o f  t h e  w o r l d
    Docling force-OCR:           ong ago there was a wizard, who was extremely powerfui and ruled most of the worid

112 usable words from the embedded layer, 2056 from OCR of the same pages. The
document had been filed with the first version, and nothing flagged it: a bad
text layer reads exactly like a good one to every downstream consumer.

`bbx pdf reanalyze --force-ocr` repairs it, preserving authored fields — and
that command's own header says it exists for *"a junk text layer that needs
`--force-ocr`"* and that *"Nothing automated calls it."* The tool is built; the
detection is missing.

A cheap mechanical signal exists: the pathology is spaced-out characters, so
mean run-length of alphabetic sequences (or the ratio of 1-character "words")
separates it from ordinary text without judgment. What to do once detected is
the open part — force OCR at intake, or surface it for an agent to run
reanalyze.

## 2. `--ocr-mode full_page` loses words that `layout_regions` keeps

`doclingArgs` passes `--ocr --ocr-mode full_page` (`src/services/docling.ts`).
Docling 2.117 also accepts `layout_regions`, `pdf_aware_layout_regions`, and
`default`. Measured across four scanned documents, counting run-together words
(≥16 letters with no space) as the artifact:

| document | full_page | layout_regions |
|---|---|---|
| dense claim form | 661 words, 25 run-ons | 714 words, 7 run-ons |
| one-page order | 111 words, 0 | 105 words, 0 |
| cover letter + order | 523 words, 4 | 518 words, 0 |
| beneficiary form | 108 words, 19 | 174 words, 8 |

Never worse on artifacts, materially better on the dense forms. No new
dependency — it is a flag we do not pass.

## 3. The default OCR engine is the weakest one available

No `--ocr-engine` is passed, so Docling's default (easyocr) is used. Same page,
same mode:

| engine | words | run-together artifacts | heading "SECTION 8" |
|---|---|---|---|
| easyocr (current) | 175 | 7 | missed |
| rapidocr | 223 | 0 | found |
| ocrmac (Apple Vision) | 235 | 0 | found |

rapidocr eliminates the run-together artifact entirely and needs one added
dependency (`onnxruntime`), cross-platform. ocrmac is slightly better but
macOS-only, so it is a reference point rather than a deployable option for a
Linux host.

Scored against the page itself (read directly, rather than against another
extraction), on a notarized form with both printed and handwritten fields:

| engine | printed fields found | handwritten fields found |
|---|---|---|
| easyocr (current) | 5/8 | 5/6 |
| rapidocr | 6/8 | 6/6 |
| ocrmac | 8/8 | 6/6 |

Handwriting is not the weak spot — all three read cursive signatures and
hand-printed entries. What easyocr and rapidocr miss is small print in page
corners (form codes, page numbers); ocrmac catches those too.

A separate failure shape worth naming, seen under the current `full_page`
mode: a checkbox list came out as `- [x] includedonthisform.` — the checkbox
state correct, but only the wrapped tail of the line, dropping what was
actually being attested. On a legal certification that reads as complete while
saying nothing, which is worse than an obvious garble.

## Correction to a prior conclusion

[`plans/scanner-ingest.md`](../../beebox/docs/plans/scanner-ingest.md) records
that Docling has no hybrid "OCR only pages without a text layer" mode, citing
upstream feature requests. That is no longer accurate for 2.117:
`--ocr-mode pdf_aware_layout_regions` preserves an existing text layer and
produced byte-identical output to `--no-ocr` on a text-layer PDF. Worth noting
that finding 1 makes hybrid mode the *wrong* default anyway — preserving a
layer is only right when the layer is good.
