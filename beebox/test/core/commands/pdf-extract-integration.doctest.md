# Real Docling — the one gated integration test

Everything else about pdf mode is tested against a fake. This file runs
the **real** `uvx docling` at the pinned version over a real PDF, because the
fake cannot catch the things that actually break: a renamed CLI flag, a moved
output path, an upstream change to where artifacts land.

It is **skipped** — loudly, with a reason on stderr — wherever Docling cannot
run: no `uv` installed, no network for the first environment build, a sandbox
that forbids subprocesses. A skip is a normal outcome on a developer machine;
what would not be normal is this file silently passing while testing nothing,
so the assertion below names which of the two happened.

Warm (uv environment and model weights cached) this takes a few seconds. The
probe below runs `uvx --offline`, so an environment that is not already built
is a fast skip, never a build: building it downloads a multi-hundred-MB torch
environment and makes macOS Gatekeeper verify every dylib, which is not a
thing a test run should do on its own. Warm it once by hand with
`uvx --from docling==<DOCLING_VERSION> docling convert --help`.

The suite shares the developer's uv cache (`test/helpers/isolate-user-home.ts`),
so a warmed environment stays warm under the isolated test HOME.

```ts setup
import { createDoclingService, doclingArgs } from "../../../src/services/docling.js";
import { DOCLING_VERSION } from "../../../src/services/docling-version.js";
import { textPdf } from "../../helpers/pdf-fixtures.js";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";

// Probe: can Docling run here at all? `--offline` answers from the uv cache
// only — an already-built environment says yes in about a second, an absent
// one fails in under a second instead of building itself — and no uv at all
// throws. Either failure is a skip.
async function doclingRunnable() {
  const probe = await execa("uvx", ["--offline", "--from", `docling==${DOCLING_VERSION}`, "docling", "convert", "--help"], {
    timeout: 60_000,
    reject: false,
  }).catch((e) => ({ exitCode: 1, message: e.message }));
  if (probe.exitCode === 0) return null;
  return `uvx/docling ${DOCLING_VERSION} is not runnable here (${probe.message ?? `exit ${String(probe.exitCode)}`})`;
}

const skipReason = await doclingRunnable();
if (skipReason) console.warn(`[skipped] pdf-extract-integration: ${skipReason}`);
```

## The argv we send is the argv we mean

This part runs everywhere — it is a pure function, and it is the thing most
likely to rot when Docling changes its CLI.

```ts
doclingArgs("/scan/source.pdf", { workDir: "/work", ocr: "off", languages: null }).join(" ")
=> --from docling==«*» --with onnxruntime --with rapidocr docling convert /scan/source.pdf --to md --to json --image-export-mode referenced --table-mode fast --device cpu --document-timeout 600 --output /work -q --no-ocr
```

`--force-ocr` is deprecated upstream; `--ocr-mode` is the supported spelling.
A junk text layer must be replaced wholesale, so it gets `full_page`:

```ts continue
doclingArgs("/scan/source.pdf", { workDir: "/work", ocr: "replace", languages: ["en", "de"] }).slice(-7).join(" ")
=> --ocr --ocr-mode full_page --ocr-engine rapidocr --ocr-lang en,de
```

A PDF with no text layer instead gets `layout_regions`, which measured better
on dense scanned forms:

```ts continue
doclingArgs("/scan/source.pdf", { workDir: "/work", ocr: "regions", languages: null }).slice(-5).join(" ")
=> --ocr --ocr-mode layout_regions --ocr-engine rapidocr
```

## A real extraction over a real PDF

```ts
const dir = await mkdtemp(join(tmpdir(), "docling-real-"));
const pdfPath = join(dir, "source.pdf");
await writeFile(pdfPath, textPdf());
const workDir = join(dir, "work");
await import("node:fs/promises").then((fs) => fs.mkdir(workDir, { recursive: true }));

const result = skipReason
  ? { skipped: true }
  : await createDoclingService().extract(pdfPath, { workDir, ocr: "off", languages: null });

// One line, whichever path ran — so a skip is visible rather than a silent pass.
skipReason ? "SKIPPED" : (result.ok ? "EXTRACTED" : `FAILED: ${result.error}`)
=> «*»

skipReason ? "ok" : (result.ok ? "ok" : `FAILED: ${result.error}`)
=> ok
```

When it did run, the extraction has the shape the rest of pdf mode relies
on: markdown carrying the page's text, a `DoclingDocument` JSON on disk, and one
page render per page found by walking the work directory (Docling writes those
paths relative to an output root that does not match where the files land, so
the walk is load-bearing):

```ts continue
skipReason ? "Northwind" : (result.value.markdown.includes("Northwind") ? "Northwind" : result.value.markdown)
=> Northwind

skipReason ? 1 : result.value.pageImages.length
=> 1

skipReason ? "DoclingDocument" : JSON.parse(await readFile(result.value.jsonPath, "utf-8")).schema_name
=> DoclingDocument

skipReason ? DOCLING_VERSION : result.value.version
=> «*»
```

Page renders are PNGs Docling wrote — the AVIF re-encode happens a layer up, in
`pdf-extract.ts`:

```ts continue
skipReason ? "png" : result.value.pageImages[0].filePath.split(".").pop()
=> png
```

```ts cleanup
await rm(dir, { recursive: true, force: true });
```
