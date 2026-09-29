---
title: "WebP PDF assets and compatible image inputs"
status: draft
workstream: jev-triage
issues:
  - ../../../issues/features/2026-06-18-avif-webp-for-stored-images.md
  - ../../../issues/features/2026-08-24-pdf-card-page-addressing-gaps.md
---
# WebP PDF assets and compatible image inputs

Generate PDF page and figure images as WebP so agents and vision providers can read the derivatives directly without an AVIF conversion. Continue reading existing AVIF assets and accepting valid images without changing archived originals.

**Issues addressed:** The linked stored-image issue is partially addressed for PDF derivatives and scan input acceptance; connector-wide optimization remains open. The page-addressing issue is related, not resolved: this preserves its existing page and picture numbering.

## Smallest fix and budget

Changing the encoder alone would leave the page, figure, and triage readers looking for AVIF filenames. Update those readers together, accept AVIF in the loose-image renderer, and add WebP/AVIF to the validated scan input allowlist. Estimate 150–250 source lines changed, 200–300 test lines, and 150–200 authored documentation lines; no generated output or new subsystem.

## Stated preferences this plan trades against

The human approved WebP and said: “I do like it to be forgiving accepting valid images” and “we don't need to be transcoding if it's a big deal.” Preserve original bytes, use existing provider derivatives, and avoid a bulk transcode. Boundary validation remains explicit (engineering principle 3); supporting both formats prevents invisible loss of existing page/figure views (principle 4). Small filename recognizers retain their existing ownership; no configurable codec framework.

## What already exists

- `beebox/src/core/pdf/extract.ts:48`: `const AVIF_QUALITY = 60;`. `beebox/src/core/pdf/extract.ts:95`: `.avif({ quality: AVIF_QUALITY, effort: AVIF_EFFORT })`. Reuse extraction and naming, changing the new derivative encoding.
- `beebox/src/core/pdf/extract.ts:185`: `name !== options.keep`. Keep the original-preservation guard when cleaning both generated formats.
- `beebox/src/frontend/src/lib/pdf-card.ts:26`: `const PAGE_RENDER_RE = /^page-(\d{3})\.avif$/;`. Extend the reader, preserving page numbering. `beebox/src/frontend/src/components/DoclingView/view.tsx:33` uses `const FIGURE_RENDER_RE = /^figure-(\d{3})\.avif$/;` for the equivalent figure mapping.
- `beebox/src/core/upload-helpers.ts:17`: `SUPPORTED_IMAGE_EXTENSIONS` lists JPEG, PNG, TIFF. Extend this and scanner grouping to WebP/AVIF.
- `beebox/src/core/scan/validate.ts:30`: `const ACCEPTED_TYPES: Record<string, string[]>`; `:117`: `await Sharp(filePath, { failOn: "error" })`. Keep magic/extension agreement and complete decoding rather than accepting names alone. Accept the HEIF container MIME as an alias for `.avif` when the complete image decodes. Sharp compression metadata follows the major brand and mislabels a valid AV1 payload with a `mif1` brand; do not pretend it proves the codec. This deliberately accepts decodable HEIF-family images under `.avif`, while rejecting unrelated MIME mismatches.
- `beebox/src/core/commands/scan-import/helpers.ts:102`: `normalizeScanImages` creates provider scratch images. Reuse it; archived inputs keep their original bytes and extensions.
- `beebox/src/core/describe-images/image-input.ts:15`: `readScanVisionImage` passes supported WebP through and converts AVIF for provider compatibility. Keep that boundary for existing assets.
- `beebox/src/core/triage/evidence/packing.ts:46`: `/^page-\d{3,}\.avif$/u` identifies generated pages; `beebox/src/core/triage/evidence/core.ts:233` uses `"image/avif"` for their deferred metadata. Extend format recognition and report the true deferred-image MIME.

- `beebox/src/frontend/src/renderers/image.tsx:25`: `RAW_IMAGE_EXT` omits AVIF; add it to the existing raw-image renderer.
- `beebox/src/core/commands/scan-import/pdf.ts:134`: `name.endsWith(".avif")` counts rendered assets; update for new output.
- `beebox/deploy/hetzner/setup-server.sh:150`: `Verify AVIF encoding` names the provisioning smoke check; align it with the runtime formats.

## Prior art (external)

- [Claude vision](https://platform.claude.com/docs/en/build-with-claude/vision) accepts JPEG, PNG, GIF and WebP; AVIF is absent.
- [Gemini image understanding](https://ai.google.dev/gemini-api/docs/image-understanding) accepts WebP; AVIF is absent.
- [Sharp output](https://sharp.pixelplumbing.com/api-output/) supports WebP quality and effort options. Use quality 80, effort 4 after a synthetic two-document probe: WebP80 was 48,626/34,532 bytes versus WebP90 62,834/43,840 and AVIF60 33,721/23,752. Both WebP settings were readable on visual inspection; this is narrow synthetic evidence, not a representative scan benchmark. The original remains available for exact inspection.

- [WebP dimensions](https://developers.google.com/speed/webp/faq) are limited to 16,383 × 16,383 pixels. Proportionally bound derived images before encoding, without enlarging smaller images; keep original source bytes.

## Ontology

No new domain nouns or schema fields. Existing original files remain authoritative source bytes; page renders and figures are generated attachments. Existing `page-NNN` identifies the one-based page; `figure-NNN` maps to Docling's zero-based picture index. WebP and AVIF are encodings, not card types or processing states.

## Tracks / scope

1. **Producer and scan inputs.** Encode new page/figure assets as WebP quality 80, effort 4; proportionally bound either dimension at 16,383 pixels without enlarging, and rewrite body references through the existing mapping. Cleanup recognizes both generated extensions with at least three digits and preserves `keep`. Update scan-import counts and comments. Add WebP/AVIF to image input and filename grouping allowlists and extension/magic validation. Test the `mif1` major-brand AVIF case that file-type identifies as HEIF; require full decoding without hand-parsing the container or relying on inaccurate codec metadata. Keep complete decode and existing provider scratch conversion. First chunk: producer and real-image extraction/upload tests.
2. **Readers and triage.** Accept both extensions in PDF page discovery and Docling figure correlation, preserving indices. Add AVIF to ordinary image renderer selection. Extend owned-page triage recognition and make deferred MIME truthful; retain AVIF compatibility tests and add WebP skip/fallback coverage. First chunk: reader and triage changes with focused doctests.
3. **Guidance and verification.** PDF schema instructions describe new WebP and existing AVIF. Record the lazy guidance in the agent ledger and run a focused knowledge audit. Update the scan wire contract and current operational docs; append the changed encoding decision and measured sizes to the existing decision log. Update the provisioning image smoke check to encode/decode WebP and decode AVIF; use a tiny embedded AVIF fixture rather than require AVIF encoding for runtime support. Browser-check synthetic old/new images. First chunk: instruction updates and executed audit.

## Could this be simpler?

Only changing `.avif()` to `.webp()` produces images that current filename readers omit. Supporting both fixes that concrete silent failure (principle 4) without migration machinery. Forgiving acceptance needs only two new explicit validated pairs; a general codec registry or eager archive rewrite adds no needed behavior.

## Subplans

None: no separate vocabulary, migration, or infrastructure decision is needed.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Tall page PNG exceeds WebP dimensions and extraction throws | Add real 17,000-pixel render test | Bound derivatives proportionally before encoding | Clear exception prevented |
| New WebP pages/figures disappear from readers | Extend PDF/Docling reader tests | Both formats recognized | Silent before fix |
| Reanalysis leaves old generated images or deletes the original | Extend extraction cleanup test with both formats and preserved original | Existing keep guard; dual-format cleanup | Visible stale attachments |
| WebP pages trigger redundant vision or carry AVIF MIME | Extend evidence doctest for owned WebP pages and fallback | Dual-format ownership and actual MIME | Silent metadata/cost error before fix |
| AVIF opens as a generic download | Synthetic browser check of raw AVIF renderer | AVIF image match | Visible wrong view before fix |
| Named WebP/AVIF contains wrong or truncated bytes | Real-encoded upload validation cases | Existing magic agreement and full decoder checks | Clear rejection |
| Old AVIF assets stop reaching providers | Retain existing AVIF transport tests | Existing JPEG provider derivative | Clear provider error if broken |

## Agent-flow / user-flow edge cases

- ADDRESSED: wrong field, fabricated value, hand-edit drift — no new fields; images remain ordinary refs. Schema instructions identify current names and original-file authority.
- ADDRESSED: stale refs — untouched cards keep readable refs. Deliberate reanalysis replaces generated AVIF derivatives with WebP, so external links to generated filenames can become stale. Document this limitation and prefer stable card `?page=N` links for page references; do not add migration machinery for disposable derivatives.
- ADDRESSED: concurrent card writers — no new writer or lifecycle; reuse existing reanalysis flow.
- ADDRESSED: validation error UX — existing typed invalid-image reasons remain; test extension mismatch and decode rejection.
- ADDRESSED: transition state — old AVIF cards and new WebP cards coexist; mixed attach scopes are recognized. No card migration.

## NOT in scope

- Bulk image transcoding or replacing archived originals: unnecessary for new output compatibility.
- Generic format discovery, new codecs, or connector-wide image optimization: preserve a bounded explicit input contract.
- Gmail admission and todo annotation: separate planned work.
- Docling page-block alignment redesign: preserve existing numeric mapping; its separate issue remains open.
- Provider removal or conversion overhaul: existing AVIF compatibility remains necessary.

## Open design questions

None blocking. WebP quality 80 is chosen from the narrow synthetic probe; future measured compression tuning can change that default without a new data format.

## Knowledge audits

Add and run one `knows_about` audit requiring the generated PDF schema documentation for new WebP / existing AVIF guidance, original-file preservation, and no need to rewrite archived assets. Direct-recall probes demonstrated this lazy schema guidance is not preloaded in a cold agent context; measure the real document-reading path rather than asserting direct knowledge or expanding always-loaded guidance. Use the isolated synthetic test box, refresh its installed guidance, and record the result. Ledger placement remains lazy in schema instructions, not always-loaded guide prose.

## What will hold this after it ships

Existing doctest tiers cover extraction bytes/ref names, cleanup, upload validation/grouping, page/figure indexing and triage packing. Use actual Sharp-encoded AVIF/WebP fixtures to prove decoding and signatures. Retain provider AVIF transport tests. A synthetic browser check covers actual image display; no new test framework.

## Implementation order

Plan review, then parallel bounded producer and frontend chunks plus triage/guidance integration. Run focused tests, knowledge audit, browser checks, selected tests and static checks; get Claude diff review, adjudicate, then commit the complete follow-up. No partial landing.

## Rollout shape

Done when extraction, scan-upload/upload-helpers, PDF/Docling readers, image selection and triage evidence doctests pass; executed knowledge audit and synthetic browser checks confirm guidance and display. This changes newly generated derivatives only. Existing AVIF remains supported, with cleanup during deliberate reanalysis. Reanalysis can invalidate direct derivative-file links, as documented above. No card shape migration, archive sweep, uploader behavior change or scan contract version bump: acceptance is relaxed, as permitted by the wire contract.
