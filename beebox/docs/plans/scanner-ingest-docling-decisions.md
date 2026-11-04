---
title: "Docling Decisions Log — scanner-ingest"
status: active
workstream: unknown
issues: []
---
# Docling Decisions Log — scanner-ingest

Running log of every Docling-related choice made during implementation, for
boxholder review. Docling is a big surface with many ways to use it; these
are first choices made in the ingest context, all revisitable —
`bbx pdf reanalyze` exists precisely so extraction can be re-run after a
decision changes. Parent plan: [`scanner-ingest.md`](../implemented-plans/scanner-ingest.md).

Format: decision, why, what revisiting would look like. Implementation
appends as it goes.

## D1. `do_ocr=False` — trust the scanner's text layer

ScanSnap's OCR is the text source; Docling contributes
layout/reading-order/tables. When this was decided, Docling had no hybrid
mode; **that changed one release before our pin — see D15**, which
re-examines and keeps this default with the new facts. Force-OCR discards
the existing layer and has a long-document bug. **Revisit:** per D15's
trigger; reanalyze affected cards with `--force-ocr` meanwhile.

## D2. Invocation: `uvx docling` CLI per document, not docling-serve

No resident service to operate/monitor; uv caches one environment; scanner
volume makes per-invocation startup acceptable. **Revisit:** if latency or
throughput matters, docling-serve behind the same wrapper interface.

## D3. Pin the Docling version: `uvx --from docling==2.117.0 docling convert …`

2.117.0 is the current 2.x release (2026-07-30) and the one every flag below
was read off. Unpinned, `uvx docling` silently resolves whatever is newest, so
two runs of the same document a month apart could differ in output *and* in
which flags exist — extraction output is stored on a card, so that drift is
invisible until someone compares two cards. The pin also means one cached uv
environment per host rather than one per upstream release. **Note for the
reviewer:** the plan text said `uvx docling <pdf>`; the real 2.x CLI has a
`convert` subcommand (`docling convert <pdf>`), and `--force-ocr` is deprecated
in favour of `--ocr-mode` (D7) — the plan was written against an older CLI.
The pin is duplicated in `deploy/setup-server.sh` for the model pre-fetch;
they must move together. **Revisit:** on any Docling upgrade — re-read
`docling convert --help`, then `bbx pdf reanalyze` a sample and diff.

## D4. `--image-export-mode referenced` — page renders and figures as files

The alternative (`embedded`, the CLI default) base64s every image into the JSON,
which would put megabytes of pixels inside the gzipped `docling.json.gz` and
give us nothing to write into the attach scope. `referenced` writes real PNGs.
Notably this also gets us **page renders for free** at 144 DPI (2× the page
box) — the CLI has no page-DPI knob, so 144 is what we take; it is above
pdf-intake's proposed 150-DPI-ish target in the vertical direction and fine for
both vision models and the UI. Figure extraction stays **on** (pdf-intake's
choice, kept): figures become addressable assets an agent can look at.
**Revisit:** if page renders turn out too large or too small, the escape is
rendering pages separately with `pdftoppm -r <dpi>` and keeping Docling only
for figures.

## D5. Find artifacts by walking the work dir, not by trusting Docling's paths

Docling writes its artifact paths relative to a notion of the output root that
does not match where the files actually land: with `--output out` the markdown
says `out/<stem>_artifacts/page_000001_<hash>.png` while the file is at
`out/out/<stem>_artifacts/…`. Resolving those refs would break; the basenames
are unique and carry the page/figure index, so the wrapper walks the work
directory and keys on basename. The markdown rewrite matches image links by
basename for the same reason, and leaves unrecognized links alone rather than
dropping them. **Revisit:** if upstream fixes the relative-path skew, the walk
still works — it is strictly more tolerant. This is defensive against *their*
bug, not ours.

## D6. Two timeouts: `--document-timeout 600` inside, a 15-minute awake kill outside

Docling's own per-document budget covers conversion only, so it cannot bound
interpreter start, uv environment build, or model loading — the parts that
dominate a cold run. The outer kill covers the whole subprocess and is counted
in **awake** time (`startAwakeTimeout`), because a plain 15-minute `setTimeout`
fires the instant a sleeping laptop wakes and would kill a healthy extraction.
Both numbers are guesses sized off a warm 7-second run on a two-line PDF and
the plan's "~2 pages/sec order of magnitude" figure; nobody has timed a
200-page scan on the prod box. **Revisit:** the first real timeout in the wild
— the failure is visible (`status: new` + `error:` naming the timeout), so it
will surface rather than hide.

## D7. `--ocr --ocr-mode full_page` for `--force-ocr`, not the deprecated flag

Docling 2.117 deprecates `--force-ocr` in favour of `--ocr-mode full_page`;
both still work, one will stop. This only ever runs behind
`bbx pdf reanalyze --force-ocr`, so the known long-document force-OCR bug
(#1499) stays an escape-hatch-only risk, as the plan said. `--languages` maps
to `--ocr-lang` and is only sent alongside force-OCR, since it is meaningless
with OCR off. **Revisit:** if `--ocr-mode`'s other values (`layout_regions`,
`pdf_aware_layout_regions`) turn out to be the hybrid mode the plan wanted —
`pdf_aware_layout_regions` in particular sounds like it might be — that would
change D1 itself. Not investigated; flagged here deliberately because it is the
single most consequential thing I did not chase down.

## D8. Text-layer detection: `pdftotext` over the first 5 pages, ≥64 non-space chars

Poppler is already a deploy dependency and answers in milliseconds; starting
Docling to ask a yes/no question would cost seconds and model loading. Five
pages because a scanner OCRs a whole job or none of it. The 64-character floor
(not zero) exists because scanner output frequently carries a few stray glyphs
— a producer watermark, a page-number artifact — and one of those must not
route a photo batch into pdf mode. When `pdftotext` is missing the answer
is `true` **by assumption**, and the probe says so (`textLayerSource:
"assumed"`): that routes to pdf mode, which is what every PDF did before
this split existed, and pdf mode preserves the original either way.
Assuming `false` would send a real document through per-page vision analysis
because a package was missing. **Revisit:** if a real scan lands on the wrong
side, the threshold and the page sample are two constants in `pdf-probe.ts`.

## D9. Textless PDFs render with `pdftoppm -r 150`, not Docling

The photo branch never wants Docling's layout/table analysis — it wants pixels
for Gemini. `pdftoppm` gives them at a chosen DPI in one cheap subprocess,
where Docling would load models to produce 144-DPI renders as a side effect of
work we would throw away. (Document mode uses Docling's page renders instead —
D4 — because there the extraction is running anyway and the renders' geometry
matches the JSON's bboxes.) **Revisit:** 150 DPI is inherited from
pdf-intake-design; if Gemini reads scans better or cheaper at another
resolution, it is one constant.

## D10. AVIF at quality 60, effort 4, via sharp

pdf-intake chose AVIF; this fills in the numbers. Quality 60 keeps scanned text
legible at a fraction of Docling's PNG output; effort 4 is libvips' balance
point — higher effort costs seconds per page for single-digit percentage gains
on a scan. No system package is needed: sharp's prebuilt libvips has AVIF, and
`deploy/setup-server.sh` now proves that at install time rather than at the
first scan. **Revisit:** if page renders look mushy in the UI, or if archival
fidelity ever matters more than size, raise quality (or keep PNG for pages and
AVIF only for figures).

## D11. Model pre-fetch: `docling-tools models download layout tableformer`

Exactly the two the pipeline uses. There is no separate "TableFormer fast"
weight — one `tableformer` download covers both fast and accurate modes, and we
run `--table-mode fast` (pdf-intake's choice, kept: bills and statements, not
research papers). **No OCR weights are fetched**, which is the direct
consequence of D1 and is what shrinks the download from pdf-intake's ~200 MB to
~100 MB. `--device cpu` is passed explicitly rather than `auto`, since the
deploy target has no GPU and `auto` probes for one every run. **Revisit:** if
`--force-ocr` becomes common, the first reanalyze on each box pays a
one-time EasyOCR download; pre-fetching would then be worth it.

## D12. Card layout: `source.pdf.card` keeps the old basename

> **Note (2026-08-24):** the card type was renamed from `document` to `pdf`
> (`document` collided with the unrelated `doc.card`). This section otherwise
> describes the original decision as made; `source.document.card` below is
> `source.pdf.card` today.

Pdf mode previously wrote `source.file.card` + `source.attach/source.pdf`
in the session's attach scope. The document card takes the same basename and
the same attach directory, so the original PDF stays at exactly the path it
had, and only the card's type and siblings change. Nothing migrates (the card
type is net-new; existing `.file.card` PDFs are explicitly not retrofitted —
plan, NOT in scope), but keeping the layout means the session card's `files:`
ref and any human muscle memory still point at the same place. **Revisit:** if
one session ever carries several documents, the basename has to become
per-document — which is the multi-document-PDF question the plan deferred.

## D13. `metadata:` comes from `pdfinfo`, not from the DoclingDocument

A `DoclingDocument` carries no PDF Info dictionary — no title, no author — so
Docling cannot supply two of the three `metadata:` fields pdf-intake specified.
`pdfinfo` (poppler, already required) supplies all three, and does so on the
**failure** path too, so a card that failed extraction still says how many pages
it has. Docling's page count is the fallback when poppler is absent. All three
fields stay optional; a scanner rarely sets title/author. **Revisit:** if
Docling starts exposing document metadata, drop the extra subprocess.

## D14. No frontmatter list of page/figure assets

The card records `metadata.pages` and the schema instructions state the naming
convention (`attach/page-001.avif`, `attach/figure-001.avif`); there is no
`pages:` array in frontmatter. Rationale: the list would be pure duplication of
the directory, and a long scan would put 200 refs in the frontmatter of every
card. The cost is that the assets are discovered by convention rather than
declared. **Uncertain** — this is the decision here I would most expect a
reviewer to push back on; if agents turn out to miss the page renders, an
explicit list (or a `page-count`) is additive and needs no migration.

## D15. Hybrid OCR now exists upstream (`--ocr-mode pdf_aware_layout_regions`) — not adopted yet

D7 flagged this as the biggest unchased thread; it has now been chased
(web research, 2026-08-01). Docling 2.116.0 (2026-07-29, one release before
our pin) added an `OcrMode` enum via PR #3710: `pdf_aware_layout_regions`
starts from layout-detected boxes, drops every box already covered by a
native text cell, OCRs only the survivors, and merges with `PDF_FIRST`
priority so the scanner's text wins where both exist. Maintainers explicitly
endorsed it as the answer to the skip-OCR-on-text-layer request family
(#3464/#2036/#1229 — still open but functionally addressed; the direct
`skip_text_layer_pages` proposal #3465 was closed in its favor). On a
well-OCR'd ScanSnap page it reduces to nearly a no-op; its value is
recovering regions the scanner's OCR missed (stamps, faded text, skew).

**Decision: stay on `do_ocr=False` (D1) for now.** Costs of switching:
ship ~100 MB EasyOCR weights + a live CPU OCR path on the server for a
mechanism that rarely fires on good scans; the mode is one release old with
its region-selection internals still actively churning (PR #3746 possibly
obsoleted; FULL_PAGE-mode crash #3887 shows fresh edge cases). The benefit
is empirical — it depends on how often real ScanSnap output has OCR gaps,
which we have no data on yet. **Revisit:** after real scan volume, if triage
surfaces documents with missing/garbled text regions (the symptom of scanner
OCR gaps), or once the mode is a few releases old — switching is a config
change plus deploying OCR weights, and `bbx pdf reanalyze` back-fills
existing cards.

## D16. Hard caps on extraction output: 500 artifacts, 1 GiB

Docling decides how many page renders and figures it writes and how big they
are; everything after it (gzipping the canonical JSON, re-encoding every image
to AVIF) is per-artifact work in the box's own server process. So
`checkExtractionBounds` runs between extraction and re-encode and fails the
extraction past either cap: **500 page/figure artifacts**, or **1 GiB of
combined artifact bytes** (page renders, figures, and the DoclingDocument JSON,
which is itself read whole into memory). A failure here is the same outcome as
any other extraction failure — `status: new` plus `error:` on the card, the
original bytes filed verbatim — so intake still completes and a boxholder sees
what happened on the card rather than in a log. Subprocess output is bounded
the same way, by streaming through a 64 KiB tail rather than buffering
everything Docling prints.

Both numbers are **admitted guesses, sized to scanner reality**: a 200-page
scan is already a huge single document, so 500 artifacts is beyond anything
plausible from a scanner and reads as "something is wrong" rather than "this
document is large". 1 GiB is likewise far past a 50 MB upload's plausible
render set. They are limits on pathology, not on size.

**Revisit:** if a legitimate document ever trips one — a real multi-hundred-page
manual, or a figure-dense technical PDF — raise the number rather than removing
the cap, and reconsider whether page renders should be produced at all for a
document that long (D14's page-list question is adjacent).

## D17. WebP derivatives; AVIF remains readable (2026-09-28)

Supersedes D10 for newly extracted page and figure images. Use WebP quality 80,
effort 4 through the existing Sharp encoder. Existing AVIF attachments remain
readable; archived original PDFs and image inputs are unchanged. This avoids an
extra conversion for consumers that accept WebP but not AVIF, including vision
providers. The existing vision transport still converts old AVIF when required.

A bounded synthetic probe compared the checked-in `photo-property.png` and the
first page of `scan-financial.pdf`, rendered at a 2,000-pixel long edge. Inputs
live under `test/fixtures/triage-evaluation/documents/raw/`; all encoders used
effort 4. This is a small legibility check, not a representative scan benchmark.

| Synthetic document | AVIF quality 60 | WebP quality 80 | WebP quality 90 |
|---|---:|---:|---:|
| Rotated property note (2058 × 1632) | 33,721 bytes | 48,626 bytes | 62,834 bytes |
| Raster financial letter (1546 × 2000) | 23,752 bytes | 34,532 bytes | 43,840 bytes |

Visual inspection found the WebP quality-80 text readable. It saved about 22%
against quality 90 on these inputs, while costing about 45% more than AVIF60.
Choose that tradeoff for direct compatibility. Exact layout and source fidelity
remain available in the original PDF; dense or faint real scans may justify
future quality tuning.

Reanalysis clears generated assets in both formats, then creates WebP assets.
A direct link to an old generated filename can therefore become stale after
reanalysis. Prefer links to the PDF card with `?page=N` for page addressing.
This does not rename attachments in untouched cards or run a bulk conversion.
Provisioning checks WebP encoding/decoding and existing AVIF decoding.

WebP has a [16,383-pixel side limit](https://developers.google.com/speed/webp/faq).
Bound generated images proportionally to that limit without enlarging smaller
images. This keeps unusually tall PDF pages extractable while retaining the
original document and Docling coordinates.

## D18. A Python driver bounds memory; one conversion at a time (2026-11-03)

Supersedes the CLI half of D2 and the argv of D3, D4, and D7; their choices
(pinned version, rapidocr, fast tables, CPU, 144-dpi page renders, figures on,
OCR modes) are kept unchanged. Plan: [`docling-memory.md`](docling-memory.md).

**Problem.** Two concurrent conversions stalled a hosted box at its 1 GiB
`MemoryHigh`. Measured alone, one CLI conversion did not fit either. With
`--image-export-mode referenced` the CLI turns on page and picture images,
which makes the pipeline keep every page's 2x render until the document is
assembled (`standard_pdf_pipeline.py:598`, about 14 MB a page). Batches of four
pages and 100-page queues between stages add a spike on top.

**Decision.** `core.ts` runs `convert.py` (beside it) through the same `uvx`
environment. The driver builds the CLI's options for our flags, then changes
only these: no page or picture images in the pipeline; layout, table and OCR
batches of 1; `queue_max_size` 4; `MALLOC_ARENA_MAX=2`. After conversion it
renders each page with the same backend call the pipeline uses, crops that
page's figures, writes them, and frees the render. It saves JSON in placeholder
mode with the file URIs already set, because referenced mode deep-copies the
document and loads every image back in. The CLI exposes none of the batch or
queue settings (`--page-batch-size` measured no effect).

Before importing Docling, the driver takes a kernel `flock` on
`$HOME/.cache/bbx-docling.lock` (per box on a hosted host, per user on a
laptop), then on `$UV_CACHE_DIR/bbx-docling.lock` (host-wide). The kernel
releases both when the driver exits, so a lock cannot expire while Docling
runs or outlive it. The driver exits when its Node parent is gone. A wait over
20 minutes fails as "another conversion ran too long". A SIGKILL is reported as
an out-of-memory kill only when the cgroup's `oom_kill` count rose.

**Measurements.** Ubuntu 24.04 arm64 VM, 3 CPUs (prod is x86_64, 3 CPUs), each
run in a fresh cgroup v2 child, peak anonymous memory sampled from
`memory.stat`. Six public PDFs from a hosted box, described by shape:

| PDF | CLI peak | Driver peak | CLI time | Driver time |
|---|---:|---:|---:|---:|
| 9-page digital, 1 figure | 1,398 MB | 851 MB | 19 s | 19 s |
| 56-page digital, mostly tables, 31 figures | 2,320 MB | 1,125 MB | 176 s | 216 s |
| 85-page digital, tables | 2,518 MB | 1,107 MB | 264 s | 285 s |
| 122-page digital report | 3,398 MB | 1,025 MB | 457 s | 268 s |
| 333-page digital manual | OOM-killed at a 3.5 GB cap after 110 s | 1,041 MB | — | 652 s |
| 16-page 200-dpi scan, OCR `regions` | 2,048 MB | 1,562 MB | 135 s | 141 s |

Where the driver's memory goes (56-page report): Python and Docling imports
about 256 MB; layout and table models about 290 MB more; then a spike during
inference. The table model accounts for about 370 MB of the spike and most of
the time; with tables off the peak was 716 MB. On scans, RapidOCR's text
detector adds about 900 MB at its peak: Docling OCRs at 3x, and the detector's
`limit_type: min` never shrinks a large input. Changing that changes OCR output,
so it waits for a quality comparison (D7, D15).

Tried and not adopted: one inference thread or two (under 5%); chunking a
large PDF with `page_range` and `DoclingDocument.concatenate` (no gain once
page images leave the pipeline, and it changed text at 2 of 6 chunk boundaries,
where Docling joins paragraphs across pages); the pypdfium2 backend and
disabling torch compile (no measurable gain).

**Output.** Byte-identical to the CLI for the same options on every PDF above
that the CLI could finish: the same page and figure file names, which carry a
SHA-256 of the pixels, the same markdown, and the same JSON apart from file
paths. On macOS, where the CLI has the memory to finish, the 333-page manual
and the scan with OCR `replace` and a language override were identical too.
Deliberate difference: when Docling ends with a status other than
success, the CLI exits 0 with no files; the driver exits 1 with the status and
Docling's errors.

**Limits.** 2 GiB per box (`MemoryHigh=2G`; with it, proposed `MemoryMax=2560M`
and `OOMPolicy=continue`) fits one conversion beside the box server and a chat
(about 550 MB). If the OOM killer picks the `bbx` process that waits on Docling
rather than Docling itself, no card error is written; the journal has the kill.
Agent subprocesses now inherit `UV_CACHE_DIR` and `HF_HOME`: before this they
built a private uv environment and model cache per box (6.4 GB and 506 MB on
one box) and would have missed the host lock.

**Revisit:** on every Docling upgrade, repeat the comparison: run the CLI and
the driver on the same PDFs and compare artifact names, markdown, and JSON. If
upstream exposes batch and queue sizes on the CLI, the driver can go.
