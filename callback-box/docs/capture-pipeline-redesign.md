# Capture Pipeline Redesign

## Problem

The current `process-captures` procedure uses 7 agent steps (summarize, purpose, describe-images, assemble, rename, plan-extraction, extract). This is slow, unpredictable, and fails mid-way. The pipeline should be mostly deterministic with targeted agent use.

## New Pipeline

### Phase 1: Deterministic Assembly

No agents. Runs immediately after capture finalize (or on next tick).

1. **Transcribe audio** — Voxtral API call per audio clip (already exists as `cb transcribe-captures`)
2. **Image text extraction** — Per-image API call for OCR/text extraction:
   - Extract readable text from documents, bills, receipts, etc.
   - Brief contextual caption (just enough to place the image — not a full description)
   - Use a dedicated OCR service (Mistral OCR or Gemini Flash — see comparison below)
   - This is a bulk operation, not agentic — one API call per image
3. **Assemble session card** — Build the session card with:
   - Full transcript with `<image ref="...">` nodes interleaved at correct timestamps
   - If no audio: list all images in capture order
   - Image captions and extracted text attached to image cards
   - No images lost — every image placed in the best location available

Output: A complete session card with transcript + images placed, and image cards with basic captions and extracted text.

### Phase 2: Agent Enrichment (single Sonnet subagent)

One subagent call with strict mandate. Gets the assembled session card + all image cards as context.

Responsibilities:
- Write `<purpose>` on the session card (one sentence: what is the user doing?)
- Write `<summary>` on the session card
- Refine/improve image descriptions on image cards (agent sees all images together, understands the session as a whole)
- Rename the session directory to something descriptive (`cb mv`)
- Can mark images or audio as `status="invalid"` if clearly unimportant (accidental photos, blank recordings, etc.)
- **Cannot** create new cards, delete files, or move files between directories

The key insight: the agent sees all images *together* as a group, which gives much better context than processing each image independently. A photo of a check next to a photo of a bank statement tells a different story than either alone.

Max turns: ~10. All edits within the one capture directory.

### Phase 3: Deterministic Cleanup

No agents.

- Move anything marked `status="invalid"` to trash (or delete)
- Set final status on the session card (e.g., `status="enriched"` or `status="ready"`)
- Commit

### Phase 4: Sorting / Triage

Where the capture session ends up. This is the least defined phase.

Options:
- **Extract records** (current behavior) — create record cards in `store/catalogs/`. Good for structured documents (bills, receipts, tax forms).
- **Archive as-is** — move the whole session to `store/archive/captures/`. Good for reference material.
- **Convert to memo** — create a memo card from the transcript. Good for voice notes.
- **Keep for later** — move to a holding spot under `store/` for later processing.

This might just be the regular intake triage system — once the capture is assembled and enriched, it's just another inbox item. Or it might need a capture-specific guide.

**TBD**: How sorting is guided. The current system is too biased toward record extraction. Needs more flexibility.

## Image Extraction / OCR Options

### Requirements
- Good at structured documents (bills, statements, receipts, tax forms)
- Extract text content accurately
- Ideally: understand document structure (amounts, dates, account numbers)
- Cost-effective at volume (many images per capture session)
- Node.js/TypeScript integration available

### Top Contenders

#### Mistral OCR 3
- **Cost**: $0.10/100 pages ($0.05 via batch API)
- **Quality**: Purpose-built OCR. State-of-the-art on OmniDocBench. Great on tables, forms, handwriting.
- **Output**: Markdown with proper table structure (HTML rowspan/colspan). Can combine with Pixtral for structured JSON.
- **Integration**: `@mistralai/mistralai` npm package. Already using Mistral for Voxtral transcription.
- **Verdict**: Best dedicated OCR option. Already have the API key. Natural fit since we use Voxtral.

#### Gemini Flash
- **Cost**: ~$0.02/100 pages. Free tier: 250 req/day.
- **Quality**: ~95% on printed text. Good general vision model.
- **Output**: Whatever you prompt for — raw text, JSON, etc.
- **Integration**: `@google/generative-ai` npm package.
- **Verdict**: Cheapest option. Free tier is generous enough for normal use. Requires prompt engineering for structured extraction.

#### Claude Haiku 4.5 (batch)
- **Cost**: ~$0.07-0.15/100 images
- **Quality**: Excellent contextual understanding. Best at interpreting ambiguous fields.
- **Output**: Whatever you prompt for. Excellent at filling JSON schemas.
- **Integration**: Already in the stack.
- **Verdict**: Already available, great quality. Slightly more expensive than dedicated OCR but no new dependency. Good fallback.

#### GLM-OCR
- **Cost**: Free (cloud Flash model, or self-hosted 0.9B model via Ollama)
- **Quality**: #1 on OmniDocBench V1.5. Excellent on tables, formulas, documents.
- **Output**: JSON with labels/bounding boxes, or Markdown.
- **Integration**: Python SDK only. No Node.js. Would need REST API calls or subprocess.
- **Verdict**: Best accuracy, free, but Python-only SDK adds friction. Could self-host the tiny 0.9B model.

### Recommendation

**Start with Mistral OCR 3.** We already have the Mistral API key for Voxtral, the npm package is already a dependency, it's cheap ($0.001/page), and it's purpose-built for document extraction. Returns Markdown with tables — a natural fit for storing extracted text in image cards.

**Fallback to Claude Haiku** for images that aren't documents (photos of physical objects, whiteboards, etc.) where OCR isn't the right framing and you want a contextual caption instead.

**Consider Gemini Flash** later if volume gets high enough to care about the cost difference.

### Cost Comparison (100 pages)

| Option | Cost | Structured? | Node.js? | Notes |
|--------|------|-------------|----------|-------|
| Gemini Flash (free tier) | $0.00 | Via prompting | Yes | 250 req/day limit |
| GLM-OCR (self-hosted) | $0.00 | JSON/Markdown | Python only | 0.9B model, runs on CPU |
| Gemini Flash (paid) | ~$0.02 | Via prompting | Yes | |
| Mistral OCR 3 (batch) | $0.05 | Markdown+tables | Yes | Already have API key |
| Claude Haiku 4.5 (batch) | ~$0.10 | Via prompting | Yes | Already in stack |
| Mistral OCR 3 | $0.10 | Markdown+tables | Yes | |
| Claude Sonnet 4.6 (batch) | ~$0.30 | Via prompting | Yes | Overkill for OCR |
| Azure DI (prebuilt invoice) | $1.00 | Key-value pairs | Yes | Best for known doc types |
| Google Document AI (extractor) | $3.00 | Key-value pairs | Yes | |
| Amazon Textract (forms) | $5.00 | Key-value pairs | Yes | |

Skip: Tesseract.js (can't handle document layouts), Google Cloud Vision (superseded by Document AI), PaddleOCR/Surya/Marker (Python-only, self-hosted complexity).
