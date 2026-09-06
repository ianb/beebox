# Which route a scanned PDF takes

A scanned PDF is a document. It used to be routed on whether it carried a text
layer: one with text became a `pdf.card`, one without was assumed to be a batch
of photographs wrapped in a PDF and sent through the photo flow.

That made a scanner setting decide the pipeline. The same paperwork scanned
with "searchable PDF" turned off became photo pages, each raising a `photo |
back-of-photo | trash` question that no answer fit — and one real document was
trashed unfiled, because triage had nothing but that question to work from.
Whether a text layer exists says how to *get* the text, not what the material
*is*.

So a PDF now goes to pdf mode either way, and pdf mode turns on Docling's OCR
when there is no text layer to read. The photo flow keeps the material it was
built for: batches of image files, and a PDF the caller explicitly says is
photos.

```ts setup
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { execa } from "execa";
import { createFakeDocling } from "../../../src/services/docling.js";
import { runPdfMode } from "../../../src/core/commands/scan-import-pdf.js";
import { createCollectorContext } from "../../../src/core/commands/index.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { textPdf, textlessPdf } from "../../helpers/pdf-fixtures.js";

// Annex-converted boxes only: scan-import stages raw asset bytes, which a
// manifest-scheme box gitignores (issues/bugs/2026-09-04-scan-import-gitignore-
// blocks-attach-staging.md).
// The OCR decision reads the PDF's text layer, which needs poppler.
const havePdftotext = await execa("pdftotext", ["-v"], { reject: false }).then(
  (r) => r.exitCode === 0,
  () => false,
);

async function importPdf(box, bytes) {
  const pdfPath = join(box.root, "incoming.pdf");
  await writeFile(pdfPath, bytes);
  const docling = createFakeDocling({ markdown: "# Scan\n", pageCount: 1, figureCount: 0 });
  const { ctx } = createCollectorContext(box.root);
  const result = await runPdfMode(ctx, { pdfPath, docling });
  return { result, docling };
}
```

## A PDF with no text layer is still a document — and Docling is told to OCR it

The card is a `pdf.card`, not a set of photo cards, and the extraction ran with
OCR on because there was no text layer to read.

```ts
const box = await makeTmpBox({ git: true, annex: true });
const { result, docling } = await importPdf(box, textlessPdf());
[result.success, result.data.mode].join(" ")
=> true pdf
```

```ts continue
havePdftotext ? docling.calls[0].forceOcr : true
=> true
```

```ts cleanup
await box.cleanup();
```

## A PDF that already carries text is left alone

Its own text layer is better than re-OCRing an image of it, and Docling's
full-page OCR mode would discard it (docling#1499 and #3582 report that path
corrupting long documents).

```ts
const box = await makeTmpBox({ git: true, annex: true });
const { result, docling } = await importPdf(box, textPdf());
[result.success, result.data.mode].join(" ")
=> true pdf
```

```ts continue
havePdftotext ? docling.calls[0].forceOcr : false
=> false
```

```ts cleanup
await box.cleanup();
```

## Neither route raises a photo-taxonomy question for a document

The concrete regression this guards: a document page reaching a question whose
only options are photo, back-of-photo, or trash, with delete as the fallback.

```ts
const box = await makeTmpBox({ git: true, annex: true });
const { result } = await importPdf(box, textlessPdf());
result.data.questions === undefined || result.data.questions.length === 0
=> true
```

```ts cleanup
await box.cleanup();
```
