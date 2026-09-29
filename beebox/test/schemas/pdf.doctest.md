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
import { createCardSchemaMap } from "../../src/schemas.js";

const schemas = await createCardSchemaMap();
const source = "_content/inbox/scan.attach/source.pdf.card";
```

## Registered as `pdf`

```ts
PdfSchema.type
=> pdf

schemas.get("pdf") === PdfSchema
=> true
```

## An extracted card round-trips

```ts
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
JSON.stringify([parsed.fields.format, parsed.fields.metadata.pages, parsed.fields.docling.version, parsed.fields.error ?? null])
=> ["pdf",14,"2.117.0",null]
```

The provenance entry is the same shape `file.card` uses, so anything that reads
a file card's `filename:` reads a pdf card's too:

```ts continue
JSON.stringify(parsed.fields.filename)
=> {"ref":"attach/source.pdf","via":{"channel":"scan-import","at":"2026-04-02T10:23:00Z"},"original-name":"utility-bill.pdf","mime-type":"application/pdf","size":248392}

FileSchema.frontmatterSchema.safeParse({ type: "file", filename: parsed.fields.filename }).success
=> true
```

`via.original` is the date of the original document, at whatever precision is
known; anything that is not an ISO date is rejected:

```ts continue
const withOriginal = (original: string): boolean =>
  FileSchema.frontmatterSchema.safeParse({
    type: "file",
    filename: { ...parsed.fields.filename, via: { ...parsed.fields.filename.via, original, note: "Found in the attic" } },
  }).success;
JSON.stringify(["1974", "1974-06", "1974-06-02", "June 1974"].map(withOriginal))
=> [true,true,true,false]
```

## A failed extraction: an `error:`, no `docling:`

```ts
const card = createPdfTemplate({
  format: "pdf",
  via: { channel: "scan-import", at: "2026-04-02T10:23:00Z" },
  filename: "source.pdf",
  error: "Docling exited 1: model weights unavailable",
  body: "",
});
const parsed = parseCardText(card, { source, schemas });
JSON.stringify([parsed.fields.error, parsed.fields.docling ?? null, parsed.rawBody])
=> ["Docling exited 1: model weights unavailable",null,""]
```

## An agent's judgement is `unusable: true`, and `format` is required

```ts
const base = { type: "pdf", format: "pdf", filename: { ref: "attach/x.pdf", via: { channel: "scan-import", at: "2026-04-02T10:23:00Z" } } };

PdfSchema.frontmatterSchema.parse({ ...base, unusable: true }).unusable
=> true

PdfSchema.frontmatterSchema.safeParse({ ...base, unusable: "yes" }).success
=> false
```

A card with no `format:` is rejected rather than silently assumed to be a PDF:

```ts continue
PdfSchema.frontmatterSchema.safeParse({ type: "pdf", filename: base.filename }).success
=> false
```

## The instructions say the three things an agent needs

They are also the knowledge-audit target (`scanner-ingest-document-card`): what
the card is, where the original bytes live, and what an `error:` means.

```ts
const text = PdfSchema.instructions ?? "";
JSON.stringify([
  text.includes("attach/source.pdf"),
  text.includes("`error` — present when extraction failed"),
  text.includes("bbx pdf reanalyze"),
])
=> [true,true,true]
```
