# Document triage experiment — 2026-09-28

**Recommendation: prepare evidence before admission and destination choice.**
Jev matched 11 of 12 authored destination labels; changing
only the classifier would preserve missing-attachment, MIME, and truncation
failures. No production routing was changed and no thresholds were fitted.

The [corpus and replay tools](../../test/fixtures/triage-evaluation/README.md)
contain 27 authored household-administration cases: 12 destination examples, 10 MIME email examples,
and five raw PDF/image cases. All content is synthetic. The
[plan](../plans/jev-document-triage.md) records the accepted admission boundary
and remaining design decisions.

## Method

The current triage pass already uses `loadEffectiveSmallModel`. It is one
baseline, not separate current-agent and smallModel implementations. Runs
configured `claude-haiku-4-5-20251001`; the returned agent result does not
independently identify the provider model. Live Jev returned
`typesafe/jev-1.13-20260917` through the existing OpenRouter service.

Expected labels/text were authored before model calls, kept separate from
actual extraction, and excluded from model state. The replay used one Jev
call per item; the email experiment put admission and destination questions
in the same call. Agent runs used `runTriage` with `dryRun: true` against fresh
synthetic boxes. No filesystem routing decisions were applied.

The test box initially had no granted OpenRouter key and no recorded cases in
its inspected triage paths/history. The boxholder then authorized a separate
local key for synthetic tests and clarified that no trusted corpus exists.
A read-only, explicitly authorized private sample informed format coverage;
no private document contents, rules, identifiers, or credentials are included
in these artifacts or were sent to Jev. Existing real placements were not
used as truth labels. No local private clone was needed.

## Results

| Trial | Current smallModel | Jev | Limit |
|---|---|---|---|
| 12 short documents, eight fictional destinations | 12/12 authored labels, 29.1 s batch | 11/12, 2.6 s summed calls | Simple synthetic text; no calibration |
| Four successfully prepared PDF/image documents | 4/4, 14.5 s batch | 4/4, 1.1 s summed calls | Actual extracted text supplied; not raw multimodal Jev |
| One corrupt PDF | Not classified | Not classified | Explicit preparation failure, not semantic no-match |
| 10 MIME cases, snippet and prepared variants | Current MIME text and clipping | 20 calls, no transport errors, 4.2 s summed calls | Representation probe; unequal evidence prevents a model-quality comparison |

Actual model cost was not exposed by these service results and is unknown.
Times are observations, not a performance benchmark: different batch shapes,
cold starts, and local agent orchestration are included. The sample is small,
clear, English-language, and authored for known boundaries; there is no
held-out split, representative prevalence, or real-box error-rate estimate.

These observations supersede the earlier synthetic scenario. The corpus was
rewritten as household administration at the boxholder's request, all raw
PDF/image fixtures regenerated, and every retained model observation rerun.
Earlier outputs are not relabeled or retained as current evidence.

The household rerun introduced one destination disagreement: cloud-storage
research notes were labeled no-match (0.56) rather than notes (0.39). The current
agent matched the authored notes label. We retained the failure without tuning
the fixture/rules. This is a new scenario run, not an equivalent-input estimate
of improvement over the previous corpus.

## Failures that determine the pipeline

1. **Relevance can be after the snippet or 4,000-character cutoff.** In the
   recorded MIME run, Jev called the late-relevance snippet irrelevant with
   probability 0.71. With the full body it chose relevant (0.95) and the
   correct legal destination. The current agent held the clipped version.
   Neither number establishes a safe rejection threshold.
2. **Usable HTML can be hidden behind a plain placeholder.** The existing
   MIME parser chooses the plain alternative even when it only says to open
   the HTML version. The useful account-closure text never reaches either
   classifier through that normalized body. Jev admission stayed unresolved;
   its destination answer preferred insufficient evidence (0.55), with no-match
   close behind (0.45). Code must gate
   on preparation/admission state rather than accept that destination answer.
3. **Attachment download is not attachment evidence.** The attachment-only
   case contains a real synthetic PDF reference. Current MIME preparation
   fetches its bytes, but supplies no extracted text to triage. Jev stayed
   unresolved. The same PDF classified correctly after actual OCR.
4. **Nonempty PDF text is not necessarily usable.** The junk fixture has 120
   isolated hidden letters. The existing `probePdf` identifies the layer as
   junk. Rasterization and OCR recover the readable page; using native text
   alone would discard the useful evidence.
5. **Relevance and destination are different.** A readable personal memory
   relevant to the fictional box has no destination in the three-category
   email trial. The broader eight-category trial has a history destination.
   With the full body, Jev chose relevant (0.85), while no destination fit
   (0.93). These are separate judgments; lack of a destination must not imply
   rejection. The snippet was insufficient for admission (0.56). Questions in
   one request are independent per provider documentation; neither answer can
   be used as hidden context for the other.

## Preparation evidence

`documents/prepare.py` uses real Poppler and Tesseract, never intended text as
an extraction substitute. It asserts usable native text for the digital PDF,
empty native text for the scan, the isolated-token junk layer, essential OCR
phrases for recoverable scans/images, and an explicit failure for the corrupt
PDF. The valid PDF pages and rotated document image were visually inspected.
The image is a raster illustration with intentional rotation, not a real
camera photo. OCR noise was retained in actual output.

These tools demonstrate stages, not a new production extractor. Production
already has Docling/PDF probing and image-analysis services to reuse. Object
photographs require semantic vision descriptions, not OCR alone. Handwriting,
long scans, encryption, difficult lighting, multilingual input, and rich visual
structure remain outside the initial corpus.

## Reproducibility and review

Generated observations are under the corpus's `results/2026-09-28/`; the
README gives offline and live commands. All retained household runs used
neutral staged filenames and opaque Gmail IDs from the start. The changed
scenario reran 36 live Jev calls and three current-agent batches; the separate
instruction report covers its 192 rerun calls. Expected extraction text stayed
separate from actual Poppler/Tesseract output.

All scored agent cases returned explicit decisions, not the synthesized
missing-response fallback. No unknown categories occurred. Null/guess outcomes
are held by production routing, even if a confidence word is inconsistent;
the experiment reports classification and preparation, not successful moves.

The first cross-model review identified that the reason also feeds guide
learning. The plan therefore retains grounded semantic explanations for
uncertain cases rather than replacing them with ranking prose. It also
separates missing-output protocol failures from semantic no-match. Final review
caught the email ID leak and silent skipping of unexpected extraction failures;
both were fixed. Unexpected preparation statuses now abort before model calls,
and expected unclassified documents are counted explicitly. A negative check
confirmed a simulated extraction failure is rejected.

## Decision and remaining gate

Adopt shared evidence preparation and replayable document decisions. Connector
admission follows as a separate implementation once its privacy boundary is designed. The boxholder approved no unadmitted content in box files or Git:
keep unresolved mail at the source with ID-only pending state, and delete
allowed temporary extraction files. Current Gmail pending summaries do not
meet that policy yet. Tracked-thread refresh and manual tracking semantics
must also be settled before claiming the admission boundary works.

Do not choose automatic rejection or routing thresholds from this corpus.
The boxholder chose explicit unclear outcomes, policy-driven best effort,
agent-led instruction correction and per-item commit provenance. Mandatory
upfront calibration is not required. The full plan describes those contracts; the production evidence,
admission, pending-state migration, and Jev-routing integration remain work
to implement. Quick-capture routing is outside this workstream.

## Implementation smoke

After implementing the production preparation/snapshot/judgment functions, two
fresh live calls used the first two household fixtures through those functions
in a disposable synthetic box. Both matched their authored targets (legal and
money), returning `typesafe/jev-1.13-20260917`. This checks the production request
shape against the real provider; it is not a new accuracy study. No real box
content was sent. Deterministic tests cover routing, replay and recovery.
