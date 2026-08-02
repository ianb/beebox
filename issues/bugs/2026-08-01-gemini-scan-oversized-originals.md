---
title: Gemini scan path sends unnormalized originals (TIFF, 8–10 MB photos)
---

`cb scan-import`'s photo flow archives input files verbatim and sends those
copies to the analysis backend (`callback-box/src/core/commands/scan-import.ts`
— the `.scan-archive` copy loop). The Claude backend normalizes every page
before send (`scan-vision-claude.ts`: sharp → JPEG, long edge 2000px, q88),
but the opt-in **Gemini backend does not** — `analyzeScanBatchWithGemini`
base64-inlines the archived file as-is.

Two latent failure shapes on the Gemini path:

- Scan upload accepts `.tif`/`.tiff` (`upload-helpers.ts`), which reaches
  Gemini with `getMimeType`'s answer; whether Gemini accepts TIFF inline data
  is unverified.
- The model-comparison work found 8–10 MB phone originals "don't fit in one
  request for either vendor" (`scratch/model-comparison/REPORT.md`) — an
  8-page batch of such originals plausibly blows the request size limit.

This predates the ScanVision service (it was true of the Gemini-only flow);
found during the codex review of `callback-box/docs/plans/scan-vision-claude.md`
(finding 3) and deliberately not fixed there — the default backend no longer
hits it. Likely fix: move the Claude backend's normalization step down into
the shared runner (or into `GeminiScanVision`) so both backends see the same
bounded JPEGs.
