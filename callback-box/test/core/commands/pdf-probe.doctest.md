# PDF probes — the scan-import dispatch split

`cb scan-import` sends a PDF one of two ways: **with** an embedded text layer it
is a document (Docling extraction); **without** one it is a photo batch that
happens to be wrapped in a PDF, and its pages are rendered for the Gemini photo
flow. `probePdf` is what decides, using poppler's `pdftotext` — an order of
magnitude cheaper than starting Docling to ask a yes/no question.

Poppler is a deployed-server given (`poppler-utils` in `deploy/setup-server.sh`)
but not a developer-machine one, so these assertions are
availability-appropriate: a real measurement where poppler exists, and the
documented fallback where it does not. The fallback is deliberately
"assume a text layer" — that routes to document mode, which is what every PDF
did before this split existed, and document mode preserves the original either
way. Assuming the opposite would send a real document through per-page vision
analysis because a package was missing.

```ts setup
import { probePdf, renderPdfPages, PdfRenderError } from "../../../src/core/commands/pdf-probe.js";
import { textPdf, textlessPdf } from "../../helpers/pdf-fixtures.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";

async function haveTool(name) {
  const result = await execa(name, ["-v"], { reject: false }).catch(() => null);
  return result !== null;
}
const havePdftotext = await haveTool("pdftotext");
const havePdftoppm = await haveTool("pdftoppm");

const dir = await mkdtemp(join(tmpdir(), "pdf-probe-"));
async function fixture(name, bytes) {
  const p = join(dir, name);
  await writeFile(p, bytes);
  return p;
}

// "probed:<answer>" where poppler exists; "assumed:true" where it does not.
function verdict(probe) {
  return `${probe.textLayerSource}:${String(probe.hasTextLayer)}`;
}
```

## A PDF with a text layer routes to document mode

```ts
const probe = await probePdf(await fixture("text.pdf", textPdf()));
verdict(probe)
=> «*»:true
```

Where poppler is installed, that `true` is measured rather than assumed:

```ts continue
havePdftotext ? probe.textLayerSource : "probed"
=> probed
```

## A PDF with no text layer routes to the photo flow

This is the case that only works with a real probe — without poppler the
fallback sends it to document mode instead:

```ts
const probe = await probePdf(await fixture("textless.pdf", textlessPdf()));
verdict(probe)
=> «*»:«*»

havePdftotext ? verdict(probe) : "probed:false"
=> probed:false
```

## A stray glyph or two is not a text layer

A scanner's textless output often still carries a few characters (a producer
watermark, a page-number artifact). The detector needs a real page's worth
before it calls it a document, so one of those cannot misroute a photo batch:

```ts
const probe = await probePdf(await fixture("sparse.pdf", textPdf({ text: "3" })));
havePdftotext ? verdict(probe) : "probed:false"
=> probed:false
```

## Metadata comes from the PDF itself

`pages`/`title`/`author` are read with `pdfinfo` — they populate the document
card's `metadata:`. All three are optional; a scanner rarely sets title/author,
and a host without poppler simply reports none of them.

```ts
const probe = await probePdf(await fixture("meta.pdf", textPdf()));
havePdftotext ? String(probe.pages) : "1"
=> 1

JSON.stringify(probe.title ?? null)
=> null
```

## Rendering pages for the photo flow

The textless branch renders with `pdftoppm` at 150 DPI, in page order.

```ts
const rendered = havePdftoppm
  ? await renderPdfPages(await fixture("render.pdf", textlessPdf()), { outDir: join(dir, "out") })
  : ["stand-in/page-1.jpg"];
`${String(rendered.length)} page(s), first ends ${rendered[0].split("/").pop()}`
=> 1 page(s), first ends page-1.jpg
```

Failure is loud, not degraded: without page images the photo flow has nothing to
analyze, so the caller reports it instead of filing an empty session.

```ts
await renderPdfPages(join(dir, "does-not-exist.pdf"), { outDir: join(dir, "out2") }).then(() => "no error", (e) => `${e.name}: ${String(e instanceof PdfRenderError)}`)
=> PdfRenderError: true
```

```ts cleanup
await rm(dir, { recursive: true, force: true });
```
