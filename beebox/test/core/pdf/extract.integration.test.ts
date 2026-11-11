// # Real Docling — the one gated integration test
//
// Everything else about pdf mode is tested against a fake. This file runs
// the **real** Docling driver (`convert.py`, through `uvx` at the pinned
// version) over a real PDF, because the fake cannot catch the things that
// actually break: a renamed option, a moved output path, an upstream change to
// where artifacts land.
//
// It is **skipped** — a TAP skip with the reason — wherever Docling cannot
// run: no `uv` installed, no network for the first environment build, a sandbox
// that forbids subprocesses. A skip is a normal outcome on a developer machine;
// what would not be normal is this file passing while testing nothing, so a
// skip is reported as one, never as a pass.
//
// Warm (uv environment and model weights cached) this takes a few seconds. The
// test never touches the network: it sets `UV_OFFLINE` and `HF_HUB_OFFLINE` for
// itself and its children. A missing environment is a fast skip at the probe,
// never a build: building it downloads a multi-hundred-MB torch environment and
// makes macOS Gatekeeper verify every dylib, which is not a thing a test run
// should do on its own. Missing model weights are a skip at the extraction, never
// a download: on a slow link the download once outran the test's timeout, and
// `--help` in the probe never loads the models, so the probe cannot see them.
// Warm both once by hand by converting any PDF:
// `uvx --from docling==<DOCLING_VERSION> --with onnxruntime --with rapidocr docling convert <some.pdf> --output /tmp/docling-warm`.
//
// The suite shares the developer's uv and Hugging Face hub caches
// (`test/helpers/isolate-user-home.ts`), so a warmed machine stays warm under the
// isolated test HOME.

import { t as tap, test } from "tap";
import "@ianbicking/tap-check/tap";
import { createDoclingService } from "../../../src/services/docling/core.js";
import type { DoclingExtraction } from "../../../src/services/docling/core.js";
import type { Result } from "../../../src/shared/result.js";
import { DOCLING_VERSION } from "../../../src/services/docling/version.js";
import { textPdf } from "../../helpers/pdf-fixtures.js";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";

// Offline for this process and every child it starts, the real extraction
// included: uv answers from its cache, Hugging Face from its hub cache.
process.env["UV_OFFLINE"] = "1";
process.env["HF_HUB_OFFLINE"] = "1";

// Probe: can Docling run here at all? Offline, uv answers from its cache only —
// an already-built environment (with the same `--with` set the real call uses)
// says yes in about a second, an absent one fails in under a second instead of
// building itself — and no uv at all throws. Either failure is a skip.
async function doclingRunnable() {
  const probe = await execa("uvx", ["--from", `docling==${DOCLING_VERSION}`, "--with", "onnxruntime", "--with", "rapidocr", "docling", "convert", "--help"], {
    timeout: 60_000,
    reject: false,
  }).catch((e) => ({ exitCode: 1, message: e.message }));
  if (probe.exitCode === 0) return null;
  return `uvx/docling ${DOCLING_VERSION} is not runnable here (${probe.message?.split("\n")[0] ?? `exit ${String(probe.exitCode)}`})`;
}

const probeSkip = await doclingRunnable();

// Offline, uncached weights fail inside huggingface_hub's snapshot download.
// That is the one extraction failure that means "not warmed" rather than
// "broken"; every other failure stays a failure.
function weightsMissing(result: Result<DoclingExtraction>) {
  return !result.ok && result.error.includes("huggingface_hub") && /snapshot_download|offline/i.test(result.error);
}

// The request and argv are checked without Docling in
// `test/services/docling/subprocess.test.ts`.

// The extraction runs once, before the test, so that missing weights can make
// it a skip too.
const dir = await mkdtemp(join(tmpdir(), "docling-real-"));
tap.teardown(() => rm(dir, { recursive: true, force: true }));
const pdfPath = join(dir, "source.pdf");
await writeFile(pdfPath, textPdf());
const workDir = join(dir, "work");
await mkdir(workDir, { recursive: true });
const result: Result<DoclingExtraction> | null = probeSkip
  ? null
  : await createDoclingService().extract(pdfPath, { workDir, ocr: "off", languages: null });
const skipReason = probeSkip ?? (result !== null && weightsMissing(result) ? "Docling model weights are not in the Hugging Face hub cache" : null);

// ## A real extraction over a real PDF
void test("A real extraction over a real PDF", { skip: skipReason === null ? false : `pdf-extract-integration: ${skipReason}` }, async (t) => {
  const failure = result === null || result.ok ? "no extraction ran" : result.error;
  t.check(result?.ok ? "EXTRACTED" : `FAILED: ${failure}`, "EXTRACTED");
  if (!result?.ok) return;
  const run = result.value;

  // The extraction has the shape the rest of pdf mode relies on: markdown
  // carrying the page's text, a `DoclingDocument` JSON on disk, and one page
  // render per page found by walking the work directory (Docling writes those
  // paths relative to an output root that does not match where the files land, so
  // the walk is load-bearing):

  t.check(run.markdown.includes("Northwind") ? "Northwind" : run.markdown, "Northwind");

  // Page renders are PNGs Docling wrote — the WebP re-encode happens a layer up, in
  // `pdf-extract.ts`; one render per page of the one-page fixture.
  t.check(run.pageImages.map((image) => image.filePath.split(".").pop()), ["png"]);

  t.check(JSON.parse(await readFile(run.jsonPath, "utf-8")).schema_name, "DoclingDocument");

  t.check(run.version, DOCLING_VERSION);
});
