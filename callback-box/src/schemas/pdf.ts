/**
 * PDF card schema — a document whose text has been extracted, with the
 * original bytes kept alongside.
 *
 * Written by `cb scan-import`'s pdf mode (a scanned PDF that already carries
 * a text layer) and refreshed by `cb pdf reanalyze`. The card is a
 * **superset of `file.card`**: it carries the same `filename:` provenance
 * entry (ref/captured/source/original-name/mime-type/size) plus the
 * extraction-derived parts — the rendered markdown as the card body, a
 * `docling.ref:` pointing at the gzipped canonical `DoclingDocument` JSON, and
 * `metadata:` (pages/title/author).
 *
 * The type is `pdf` because that is the only format the pipeline reads
 * today; `format:` still records it. See `docs/plans/scanner-ingest.md`
 * (Track 4) and `docs/plans/scanner-ingest-docling-decisions.md`.
 *
 * Example file layout:
 *   inbox/scan-XX.attach/source.pdf.card
 *   inbox/scan-XX.attach/source.attach/source.pdf      (the original)
 *   inbox/scan-XX.attach/source.attach/docling.json.gz (canonical extraction)
 *   inbox/scan-XX.attach/source.attach/text-layer.txt  (raw text layer)
 *   inbox/scan-XX.attach/source.attach/page-001.avif   (rendered page)
 *   inbox/scan-XX.attach/source.attach/figure-001.avif (extracted figure)
 */

import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { body, cardSchema, type InferCardFields } from "../cards/index.js";

/**
 * `new` — the card exists but extraction did not succeed (see `error:`); the
 * original bytes are still attached. `analyzed` — extraction succeeded (an
 * empty body means "no readable content", which is a real answer, not a
 * failure). `invalid` — an agent judged the document unusable.
 */
export const PdfStatus = z.enum(["new", "analyzed", "invalid"]);
export type PdfStatusType = z.infer<typeof PdfStatus>;

/** Same shape as `file.card`'s `filename:` entry — a pdf card is a superset. */
const FilenameEntry = z.object({
  ref: z.string(),
  captured: z.string().datetime({ offset: true }),
  source: z.string(),
  "original-name": z.string().optional(),
  "mime-type": z.string().optional(),
  size: z.coerce.number().optional(),
});

const DoclingEntry = z.object({
  ref: z.string(),
  /** The Docling release that produced the JSON — what a reanalyze compares against. */
  version: z.string().optional(),
});

const PdfMetadata = z.object({
  pages: z.coerce.number().optional(),
  title: z.string().optional(),
  author: z.string().optional(),
});

export const PdfSchema = cardSchema("pdf", {
  description: "An extracted PDF — rendered text as the body, original bytes and page/figure renders in the attach scope",
  category: "synced",
  searchable: true,
  fields: {
    status: PdfStatus.default("new"),
    /** Source document type, e.g. `pdf`. Records what the file was — the pipeline currently only reads PDFs. */
    format: z.string(),
    filename: FilenameEntry,
    docling: DoclingEntry.optional(),
    metadata: PdfMetadata.optional(),
    /** Why extraction failed, when `status: new`. Absent on a clean extraction. */
    error: z.string().optional(),
    description: z.string().optional(),
    body: body(z.string()),
  },
  instructions: `# PDF Cards

A pdf card is a document whose text has been **extracted** — the rendered
markdown is the card body, and the original bytes stay attached beside it. It
is what \`cb scan-import\` writes for a scanned PDF that already carries a text
layer (a scanner's own OCR, or a born-digital PDF).

## Where the bytes live

Everything is inside the card's own attach scope, so refs are \`attach/…\`:

- \`attach/source.pdf\` (or whatever \`filename.ref\` names) — **the original
  file, unmodified.** Read this when the body is not enough: the exact layout,
  a signature, a stamp, a scan artifact.
- \`attach/docling.json.gz\` (\`docling.ref\`) — the canonical extraction:
  layout, reading order, bounding boxes, table structure. Gzipped JSON. Read it
  only when you need structure the markdown body dropped (e.g. cell-level table
  data or where on the page something sits).
- \`attach/text-layer.txt\` — the document's **raw text layer, verbatim**, as
  the file itself carries it (no layout analysis, no rewriting). Read it when
  you need the exact characters rather than the rendered body. Absent when the
  document carries no extractable text.
- \`attach/page-001.avif\`, \`page-002.avif\`, … — one rendered image per page,
  in page order. Use these when you want to *look* at a page.
- \`attach/figure-001.avif\`, … — figures/images pulled out of the document.
  The body references them inline.

## Frontmatter

- \`status\` — \`new\` | \`analyzed\` | \`invalid\`.
  - \`analyzed\`: extraction succeeded. An **empty body is a valid analyzed
    result** — it means the document had no readable text, not that something
    broke.
  - \`new\` **with an \`error:\` field**: extraction failed. The original file is
    still attached and is the only asset; there is no docling JSON, no page
    renders, and the body is empty. Nothing is lost — re-run extraction with
    \`cb pdf reanalyze <card>\` (add \`--force-ocr\` when the text layer
    itself is junk), or read the attached original directly, or set
    \`status: invalid\` if the file is unusable.
  - \`invalid\`: you judged the document unusable (corrupt, junk, empty scan).
- \`format\` — the source document type, e.g. \`pdf\`. \`format:\` records what
  the file was, distinct from the card type itself.
- \`filename\` — provenance for the original: \`ref\` into the attach scope,
  plus \`captured\`, \`source\`, and optionally \`original-name\`, \`mime-type\`,
  \`size\`.
- \`docling\` — \`ref\` to the gzipped extraction JSON, plus the \`version\` of
  the extractor that produced it.
- \`metadata\` — \`pages\`, \`title\`, \`author\` read from the document itself.
  Any of them may be missing; a scanner rarely sets \`title\`/\`author\`.
- \`description\` — a short summary of what the document *is*. Deliberately
  empty at intake; fill it in when you process the card.

## Body

The rendered markdown of the document — headings, paragraphs, and tables as
markdown tables. Figures appear as inline image references into the attach
scope. Treat it as a faithful-but-lossy view: it is the right thing to read,
search, and quote, and the original plus the page renders are there when it is
not enough.`,
});

export type PdfFields = InferCardFields<typeof PdfSchema>;

export interface PdfTemplateOptions {
  status: PdfStatusType;
  format: string;
  capturedAt: string;
  source: string;
  /** Name of the original inside the card's attach scope. */
  filename: string;
  originalName?: string;
  mimeType?: string;
  size?: number;
  /** Name of the gzipped DoclingDocument JSON in the attach scope, when present. */
  doclingFilename?: string;
  doclingVersion?: string;
  metadata?: { pages?: number; title?: string; author?: string };
  /** Extraction failure message — set together with `status: new`. */
  error?: string;
  /** Rendered markdown. Empty is meaningful (see the schema instructions). */
  body: string;
}

export function createPdfTemplate(options: PdfTemplateOptions): string {
  const filename: Record<string, unknown> = {
    ref: `attach/${options.filename}`,
    captured: options.capturedAt,
    source: options.source,
  };
  if (options.originalName !== undefined) filename["original-name"] = options.originalName;
  if (options.mimeType !== undefined) filename["mime-type"] = options.mimeType;
  if (options.size !== undefined) filename["size"] = options.size;

  const fields: Record<string, unknown> = {
    status: options.status,
    format: options.format,
    filename,
  };
  if (options.doclingFilename !== undefined) {
    const docling: Record<string, unknown> = { ref: `attach/${options.doclingFilename}` };
    if (options.doclingVersion !== undefined) docling["version"] = options.doclingVersion;
    fields["docling"] = docling;
  }
  const metadata: Record<string, unknown> = {};
  if (options.metadata?.pages !== undefined) metadata["pages"] = options.metadata.pages;
  if (options.metadata?.title !== undefined) metadata["title"] = options.metadata.title;
  if (options.metadata?.author !== undefined) metadata["author"] = options.metadata.author;
  if (Object.keys(metadata).length > 0) fields["metadata"] = metadata;
  if (options.error !== undefined) fields["error"] = options.error;

  return `---\n${stringifyYaml(fields)}---\n${options.body}`;
}
