// # PDF card schema
//
// A `pdf.card` is an extracted document: rendered markdown as the body, the
// original bytes and the extraction artifacts in the attach scope. It is a
// superset of `file.card` — same `filename:` provenance entry — plus `format:`,
// `docling:`, `metadata:`, and (on a failed extraction) `error:`.
//
// The type is `pdf` because that is the only format the pipeline reads today;
// `format:` still records the source type.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { is } from "@ianbicking/tap-check/check";
import { PdfSchema, createPdfTemplate } from "../../src/schemas/pdf.js";
import { FileSchema } from "../../src/schemas/file.js";
import { cardFields, parseCardText } from "../../src/core/card-io.js";
import { createCardSchemaMap } from "../../src/schemas.js";

const schemas = await createCardSchemaMap();
const source = "_content/inbox/scan.attach/source.pdf.card";

// ## Registered as `pdf`
void test("Registered as `pdf`", async (t) => {
  t.check(schemas.get("pdf"), is(PdfSchema));
});

// ## An extracted card round-trips
void test("An extracted card round-trips", async (t) => {
  const card = createPdfTemplate({
    format: "pdf",
    via: { channel: "scan-import", at: "2026-04-02T10:23:00Z" },
    filename: "source.pdf",
    originalName: "utility-bill.pdf",
    mimeType: "application/pdf",
    size: 248392,
    doclingFilename: "docling.json.gz",
    doclingVersion: "2.117.0",
    metadata: { pages: 14, title: "Statement" },
    body: "## Statement\n\nAmount due 128.40\n",
  });
  const parsed = parseCardText(card, { source, schemas });
  const fields = cardFields(parsed, PdfSchema);
  t.check(fields, {
    type: "pdf",
    format: "pdf",
    filename: {
      ref: "attach/source.pdf",
      via: { channel: "scan-import", at: "2026-04-02T10:23:00Z" },
      "original-name": "utility-bill.pdf",
      "mime-type": "application/pdf",
      size: 248392,
    },
    docling: { ref: "attach/docling.json.gz", version: "2.117.0" },
    metadata: { pages: 14, title: "Statement" },
    body: "## Statement\n\nAmount due 128.40\n",
  });

  // The provenance entry is the same shape `file.card` uses, so anything that reads
  // a file card's `filename:` reads a pdf card's too:

  t.check(FileSchema.frontmatterSchema.safeParse({ type: "file", filename: fields.filename }).success, true);

  // `via.original` is the date of the original document, at whatever precision is
  // known; anything that is not an ISO date is rejected:

  const withOriginal = (original: string): boolean =>
    FileSchema.frontmatterSchema.safeParse({
      type: "file",
      filename: { ...fields.filename, via: { ...fields.filename.via, original, note: "Found in the attic" } },
    }).success;
  t.check(["1974", "1974-06", "1974-06-02", "June 1974"].map(withOriginal), [
    true,
    true,
    true,
    false,
  ]);
});

// ## A failed extraction: an `error:`, no `docling:`
void test("A failed extraction: an `error:`, no `docling:`", async (t) => {
  const card = createPdfTemplate({
    format: "pdf",
    via: { channel: "scan-import", at: "2026-04-02T10:23:00Z" },
    filename: "source.pdf",
    error: "Docling exited 1: model weights unavailable",
    body: "",
  });
  const parsed = parseCardText(card, { source, schemas });
  const failed = cardFields(parsed, PdfSchema);
  t.check({ failed, rawBody: parsed.rawBody }, {
    failed: {
      type: "pdf",
      format: "pdf",
      filename: { ref: "attach/source.pdf", via: { channel: "scan-import", at: "2026-04-02T10:23:00Z" } },
      error: "Docling exited 1: model weights unavailable",
      body: "",
    },
    rawBody: "",
  });
});

// ## An agent's judgement is `unusable: true`, and `format` is required
void test("An agent's judgement is `unusable: true`, and `format` is required", async (t) => {
  const base = { type: "pdf", format: "pdf", filename: { ref: "attach/x.pdf", via: { channel: "scan-import", at: "2026-04-02T10:23:00Z" } } };

  const unusableCard = PdfSchema.frontmatterSchema.parse({ ...base, unusable: true });
  t.check(unusableCard, {
    type: "pdf",
    format: "pdf",
    filename: { ref: "attach/x.pdf", via: { channel: "scan-import", at: "2026-04-02T10:23:00Z" } },
    unusable: true,
  });

  t.check(PdfSchema.frontmatterSchema.safeParse({ ...base, unusable: "yes" }).success, false);

  // A card with no `format:` is rejected rather than silently assumed to be a PDF:

  t.check(PdfSchema.frontmatterSchema.safeParse({ type: "pdf", filename: base.filename }).success, false);
});
