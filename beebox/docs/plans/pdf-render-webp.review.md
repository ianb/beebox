# Plan Engineering Review — PDF render WebP

## What already exists

Reviewed extraction, validation, scanner normalization, filename readers,
provider conversion, triage ownership and deferred MIME against source. Reuse
those paths; no new codec subsystem or data migration.

## Ontology (verified against the code's own names)

Original source files, generated page renders, and figures retain their current
meaning. Only newly generated derivative encoding changes.

## Prior art (external) — verified

Claude and Gemini support WebP directly; existing AVIF uses provider conversion.
The [AVIF specification](https://aomediacodec.github.io/av1-avif/v1.2.0.html)
allows compatible-brand declarations: the major brand alone is not the codec.
Full Sharp decoding provides the existing image boundary. A real-byte probe found compression metadata follows the major brand, so it cannot establish the underlying codec in this case.

## Stated preferences this plan trades against

The human authorized WebP, forgiving valid inputs, and avoiding needless
transcoding. Originals remain untouched. Input acceptance stays validated.

## Could this be simpler? (verified)

Changing only the producer hides pages and figures from AVIF-only filename
readers. Updating those consumers together is necessary; generic registries and
archive conversion are not.

## Failure modes

Cover new output bytes, old/new filename recognition, cleanup, page MIME and
vision fallback, and rejected malformed or mislabeled input in existing tiers.

## Agent-flow / user-flow edge cases

Document that deliberate reanalysis changes derivative filenames. Stable card
page links survive the encoding change; direct derivative links may not.

## Findings

Claude Fable reviewed the plan on 2026-09-28. Four findings were adjudicated:

1. **HEIF major-brand AVIF:** accepted. Allow HEIF-container bytes under `.avif` after full decoding. A Sharp-generated AVIF with only its major brand changed to `mif1` still decodes, but Sharp reports `compression: hevc` for its unchanged AV1 payload. Reject the metadata-guard proposal: it rejects valid images. The explicit container alias may also accept decodable HEVC content under `.avif`; this is a deliberate forgiving image boundary, not proof of a specific codec. Unrelated MIME mismatches and broken image bytes remain rejected. No custom container parser.
2. **Reanalysis links:** accepted as a documented derivative limitation.
   Reanalysis replaces generated names; untouched AVIF refs remain readable.
   Add stable card-page-link guidance rather than a migration subsystem.
3. **Citations and provisioning:** correct cited lines and update the install
   smoke check for WebP output and AVIF input. Keep numeric naming consistent
   across producer/consumers; no new page-addressing design.
4. **Quality evidence:** accepted in bounded synthetic form. Two document
   fixtures were encoded and visually inspected; WebP80 retained readable text
   and saved about 22% over WebP90. Record bytes and limits in D17 of the scanner
   decision log. No claim of representative real-scan quality is made.

## NOT in scope (verified)

Gmail admission, todo annotation, bulk connector optimization, original-file
rewrites, and Docling alignment redesign remain separate.

## Things I checked and found clean

The existing provider converter already supports WebP pass-through. Scan input
normalization preserves originals and uses temporary JPEGs. Relaxing accepted
input formats does not require a scan wire-contract version bump.

Security-report scope check: scan authentication, quarantine, size/hash checks,
egress providers and credential use are unchanged. New image extensions enter
the existing format/decode validation boundary; Sharp already decodes both
formats elsewhere. No security-posture classification or report text changes
are needed for this follow-up.

Knowledge-audit tier correction: direct-recall probes did not load the schema
guidance through a fixture import; with reads forbidden the agent correctly
said the details were absent. Use `knows_about` and require the generated PDF
schema document instead. This follows the real lazy guidance surface without
inflating the always-loaded guide or claiming a recall result that did not occur.

## Finished-change review

Claude Opus reviewed the finished diff on 2026-09-28. Its material finding was
WebP's 16,383-pixel side limit: tall pages that worked as AVIF could throw while
encoding, including after reanalysis removed old derivatives. Bound new
derivatives proportionally before encoding and add an actual oversized PNG
extraction test. Original bytes remain untouched.

The contract's stale AV1-codec assertion was already corrected while the review
ran. Strengthen the truncated-AVIF assertion to prove decoder rejection.
Browser verification covers figure matching and raw-AVIF renderer selection;
the pure page reader retains mixed-format numeric-order doctests. No helper or
new export is added merely to duplicate those regexes in a test.

Verification-only Claude pass confirmed the tall-image bound and its regression
fixture, the corrected container contract, and decoder-specific rejection
assertion. No defects in those fixes remained. Focused doctests passed, as did
backend/frontend typechecking, changed-file lint, doc checks and the local
provisioning codec probe. The executed PDF knowledge audit passed 1/1.

A synthetic browser pass verified new WebP and existing AVIF PDF page strips,
Docling page/figure index association in both formats, and direct raw-AVIF
preview. Browser errors were empty; temporary fixtures were removed afterward.
