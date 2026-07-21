# PDF Intake

**Status:** active — design, not yet implemented

How PDFs (and eventually other document formats) move from upload to a structured `.pdf.card` with extracted text, tables, page renders, and figure assets — using [docling](https://github.com/DS4SD/docling) as the extraction engine.

## Problem

Today PDFs land as `.file.card` — a thin wrapper around the uploaded bytes. No text is extracted, no metadata, no thumbnails. The agent can't search PDF contents, can't render a useful preview, can't reason about what's inside without re-reading the binary every time. We want PDFs to be first-class data: searchable text in the card, page images for vision-model context, figures as separate addressable assets.

Rejected alternatives:

- **Defer to the agent**: have the agent shell out to `pdftotext` or similar on demand. Works for ad-hoc reads but no persistence, no structured tables, no figures, no page renders. The agent re-does work every turn.
- **Cloud document AI** (Google Document AI, AWS Textract, Azure Document Intelligence): better extraction in some cases, but per-page cost, network dependency, output shape differences between vendors. Revisit if local extraction quality becomes a problem.
- **PDF.js + OCR shell-out**: build our own pipeline. We'd reinvent layout detection, table extraction, OCR routing. Docling already does this.

## Approach

**Intake-time extraction.** When a PDF arrives (`cb import`, capture endpoint, email connector), the intake path runs docling synchronously, writes a `.pdf.card` with structured contents alongside the original PDF as an [asset](../glossary.md#asset), and lands the card in `box/inbox/`.

Docling produces:
- A canonical `DoclingDocument` JSON (lossless: layout, bboxes, tables, structure).
- Rendered markdown (the human/agent-readable view).
- Page images and extracted figures (saved into the attach scope).

The `.pdf.card` puts the rendered markdown in the card body, references the JSON via a `docling.ref` field, and lists metadata (pages, title, author) in frontmatter. The original PDF, the JSON, the page renders, and the figure files are all assets — committed via manifest, not git.

One PDF → one card. Splitting a multi-document PDF into separate cards (a scan batch containing five distinct letters, say) is a future thing; for now the card represents the whole PDF and downstream agents handle subdivision if needed.

## Card shape

Cards are YAML frontmatter + a markdown body (the rendered text is the body). Refs into the attach scope use the `field.ref:` nesting, mirroring `.image.card`'s `filename.ref:`:

```markdown
---
status: analyzed
filename:
  ref: attach/Tax_Return_2025.pdf
  captured: 2026-05-04T10:23:00Z
  source: disk
  original-name: tax-return.pdf
  mime-type: application/pdf
  size: 2483920
docling:
  ref: attach/docling.json.gz
metadata:
  pages: 14
  title: Form 1040
  author: ""
description: ""
---
... rendered markdown body, including figure refs like ![](attach/figure-001.avif) ...
```

`.pdf.card` is a **superset** of `.file.card`: it carries all the same upload-provenance fields (captured, source, original-name, mime-type, size) plus the docling-derived bits. When the intake router sees `application/pdf`, it routes to the PDF path; everything else stays in `.file.card`.

Status lifecycle (paralleling image cards):
- `new` — created without successful extraction (docling failed, or skipped). Holds the asset reference and any error info; agent can decide what to do.
- `analyzed` — extraction succeeded; `<text>` is populated.
- `invalid` — agent marked the card as unusable (corrupt, junk, etc.).

`description` is intentionally empty at intake. Agents fill it later when reading the card, the same way image cards get descriptions during downstream processing.

## Attach scope contents

After successful intake, a `.pdf.card`'s attach scope looks like:

```
Tax_Return_2025.attach/
  Tax_Return_2025.pdf          # the original (asset)
  docling.json.gz              # canonical extraction (asset)
  page-001.avif                # rendered page (asset)
  page-002.avif
  ...
  figure-001.avif              # extracted figure (asset)
  figure-002.avif
  manifest.json                # tracks all of the above (in git)
```

All the binaries are assets — tracked via the asset manifest, not committed to git. The card itself, the manifest, and the rendered markdown inside `<text>` are what land in commits. See [docs/asset-manifests.md](../asset-manifests.md).

Why AVIF? Smaller than PNG at similar quality, well-supported by browsers, indexable by image models. If docling only emits PNG, the intake pipeline re-encodes after extraction. JPEG is acceptable as a fallback if AVIF tooling is missing on a deployment target.

## Docling configuration

Default feature set (intentionally lean):

| Feature | State | Why |
|---|---|---|
| OCR (hybrid: only pages without text layer) | **on** | Half the use case is scanned docs |
| OCR engine: EasyOCR | **on** | Best general quality; English-capable; bigger model (~100 MB) acceptable |
| Table structure (TableFormer, fast mode) | **on** | Bills, statements, receipts |
| Layout analysis | **on** | Core to the pipeline; non-optional |
| Figure extraction | **on** | Figures become assets in the attach scope |
| Page image rendering (150 DPI) | **on** | Page renders feed vision models and the UI |
| Picture classification | off | Coarse labels, no routing depends on them yet |
| Picture description (VLM captioning) | off | Describe extracted figures the same way capture images are described — a subagent reading the figure asset directly — instead of a separate VLM pass here |
| Formula recognition | off | Rare in boxholder docs |
| Code recognition | off | Rare; raw text is fine |
| Semantic chunking | off | Not building RAG yet |

OCR runs in **hybrid mode**: trust the text layer if present, OCR only pages that lack one. Force-OCR is an opt-in escape hatch (some scanners embed junk text layers) exposed via `cb pdf reanalyze --force-ocr`.

### Box-level overrides

Per-box config at `config/intake/pdf.json` deep-merges over the code-side defaults. The default config file does **not** ship — boxes that don't customize have no file. Shape:

```json
{
  "ocr": { "languages": ["en"], "force": false },
  "tables": { "mode": "fast" },
  "extract": { "figures": true, "pages": true, "page_dpi": 150 }
}
```

`ocr.languages` controls which EasyOCR language models load. Defaults to `["en"]`; a box that regularly handles German tax documents would set `["en", "de"]`. Loading more languages costs RAM and adds model-download weight, so we don't ship a kitchen-sink default.

Other knobs land here over time. Keeping the surface narrow until real boxes ask for more.

## Commands

### `cb import` (PDF path)

`cb import upload <file>` (or whatever the file-import entry point is at the time) detects `application/pdf` and routes to the PDF intake path. Sequence:

1. Compute content hash; dedup against existing cards (same as other file imports).
2. Generate the card basename and create the attach scope.
3. Copy the PDF into the attach scope.
4. Shell out: `uvx docling <pdf> --to json --output <attach>/docling.json` (then gzip).
5. Render markdown: either a second `uvx docling --to md` pass, or hydrate from the JSON in-process if/when a JS renderer exists.
6. Re-encode page renders and figures to AVIF.
7. Write the `.pdf.card` with `status="analyzed"`, embedded markdown, metadata, and the asset references.
8. Claim all the new assets in the manifest.

On docling failure: write a `status: new` card with the original PDF as the only asset and an `error:` field carrying the failure message. The boxholder/agent can decide whether to retry, accept the file as opaque, or mark it `invalid`.

### `cb pdf reanalyze <card>`

Re-runs docling on an existing PDF card. Flags:

- `--force-ocr` — override hybrid mode and OCR every page.
- `--languages en,de` — override the box default OCR language list for this run.

Updates `docling.json.gz`, page renders, figures, and the embedded `<text>`. The card's other attrs (description, etc.) are preserved.

Uncommon operation — exists for the case where docling versions improve, OCR was wrong, or the boxholder catches a junky text layer. Not part of any automated workflow.

## Deploy

Docling downloads model weights on first call (~few GB if all models are pulled). To avoid a multi-minute hang on the first upload, the deploy script pre-fetches exactly the models we use:

- Layout model (DocLayNet variant) — ~50 MB
- TableFormer (fast variant only) — ~50 MB
- EasyOCR English weights — ~100 MB

Approximately ~200 MB total. Pre-fetched via `docling-tools models download` with a model whitelist; weights cache to the user's home dir on the server. If a box adds OCR languages later, the first reanalyze pulls those weights on demand.

The deploy script also installs `uv` (so `uvx docling` resolves) and verifies AVIF encoding is available (`ffmpeg` or `libavif`-backed Python lib).

## Failure cases

| Case | Behavior |
|---|---|
| Docling crashes mid-run | Card lands as `status: new` with an `error:` field. Original PDF is preserved as asset. |
| PDF is encrypted / requires password | Same as above. Agent can prompt the boxholder for the password and retry. |
| Docling produces empty markdown | Card lands as `status: analyzed` with an empty body. Agent treats this as "no readable content." |
| AVIF encoder unavailable | Fall back to PNG for figures and page renders. Logged once per run. |
| `uvx` not installed | Intake refuses with a clear error pointing at the deploy step. |
| Asset manifest write fails | Card creation rolled back; PDF removed from attach scope. (Standard cb-write semantics.) |

## Future review points

- **Multi-document PDFs.** A single PDF containing several distinct documents (a scan batch with five letters, a combined billing statement + envelope, ...) becomes one card today. Worth revisiting once we see real volume — probably as a downstream agent action ("split this PDF into N cards") rather than at intake time.
- **Tables as structured data.** Markdown tables are inline in the card body. If we ever want to query table contents (e.g. "extract every dollar amount across all utility bills"), we'd promote tables to addressable structure — a `tables:` frontmatter field, or sibling cards in the attach scope.
- **Image classification at intake.** Currently off. If figure type ever becomes load-bearing for routing (e.g. "diagrams go here, photos go there"), turning on docling's picture classifier is cheap.
- **VLM captioning vs agent-driven description.** Today we extract figures and rely on a subagent describing them the same way capture images are described. If docling's own VLM ever matches that quality at lower latency / cost, the consolidation might flip the other way.
- **Other formats.** Docling supports docx, xlsx, pptx, html, asciidoc, markdown. Most of those don't need extraction at intake (they're already structured), but a `.docx` could plausibly route through the same code path with the same `.pdf.card`-shaped output. Defer until the demand is real.
- **Hosted alternatives.** If local extraction becomes a bottleneck, Google Document AI / AWS Textract / Azure Document Intelligence are drop-in-ish replacements. Different output shape; would be an alternate backend behind the same intake interface.
