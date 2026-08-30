# PDF card schema

A `pdf.card` is an extracted document: rendered markdown as the body, the
original bytes and the extraction artifacts in the attach scope. It is a
superset of `file.card` — same `filename:` provenance entry — plus `format:`,
`docling:`, `metadata:`, and (on a failed extraction) `error:`.

The type is `pdf` because that is the only format the pipeline reads today;
`format:` still records the source type.

```ts setup
import { PdfSchema, createPdfTemplate } from "../../src/schemas/pdf.js";
import { FileSchema } from "../../src/schemas/file.js";
import { parseCardText } from "../../src/core/card-io.js";
import { createCardSchemaMap } from "../../src/schemas/registry.js";

const schemas = await createCardSchemaMap();
const source = "box/inbox/scan.attach/source.pdf.card";
```

## Registered as `pdf`

```ts
PdfSchema.type
=> pdf

schemas.get("pdf") === PdfSchema
=> true
```

## An analyzed card round-trips

```ts
const card = createPdfTemplate({
  status: "analyzed",
  format: "pdf",
  capturedAt: "2026-04-02T10:23:00Z",
  source: "scan-import",
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
JSON.stringify([parsed.fields.status, parsed.fields.format, parsed.fields.metadata.pages, parsed.fields.docling.version])
=> ["analyzed","pdf",14,"2.117.0"]
```

The provenance entry is the same shape `file.card` uses, so anything that reads
a file card's `filename:` reads a pdf card's too:

```ts continue
JSON.stringify(parsed.fields.filename)
=> {"ref":"attach/source.pdf","captured":"2026-04-02T10:23:00Z","source":"scan-import","original-name":"utility-bill.pdf","mime-type":"application/pdf","size":248392}

FileSchema.frontmatterSchema.safeParse({ type: "file", status: "new", filename: parsed.fields.filename }).success
=> true
```

## A failed extraction: `status: new`, an `error:`, no `docling:`

```ts
const card = createPdfTemplate({
  status: "new",
  format: "pdf",
  capturedAt: "2026-04-02T10:23:00Z",
  source: "scan-import",
  filename: "source.pdf",
  error: "Docling exited 1: model weights unavailable",
  body: "",
});
const parsed = parseCardText(card, { source, schemas });
JSON.stringify([parsed.fields.status, parsed.fields.error, parsed.fields.docling ?? null, parsed.rawBody])
=> ["new","Docling exited 1: model weights unavailable",null,""]
```

## `status` is the three-value lifecycle, and `format` is required

```ts
const base = { type: "pdf", format: "pdf", filename: { ref: "attach/x.pdf", captured: "2026-04-02T10:23:00Z", source: "scan-import" } };

PdfSchema.frontmatterSchema.safeParse({ ...base, status: "invalid" }).success
=> true

PdfSchema.frontmatterSchema.safeParse({ ...base, status: "processed" }).success
=> false
```

`status` defaults to `new` — an unstated status is the unextracted one, never a
claim that extraction succeeded:

```ts continue
PdfSchema.frontmatterSchema.parse(base).status
=> new
```

A card with no `format:` is rejected rather than silently assumed to be a PDF:

```ts continue
PdfSchema.frontmatterSchema.safeParse({ type: "pdf", status: "new", filename: base.filename }).success
=> false
```

## The instructions say the three things an agent needs

They are also the knowledge-audit target (`scanner-ingest-document-card`): what
the card is, where the original bytes live, and what `new` + `error:` means.

```ts
const text = PdfSchema.instructions ?? "";
JSON.stringify([
  text.includes("attach/source.pdf"),
  text.includes("`error:` field"),
  text.includes("bbx pdf reanalyze"),
])
=> [true,true,true]
```
