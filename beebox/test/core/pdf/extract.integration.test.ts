// # Real Docling — the one gated integration test
//
// Everything else about pdf mode is tested against a fake. This file runs
// the **real** Docling driver (`convert.py`, through `uvx` at the pinned
// version) over a real PDF, because the fake cannot catch the things that
// actually break: a renamed option, a moved output path, an upstream change to
// where artifacts land.
//
// It is **skipped** — loudly, with a reason on stderr — wherever Docling cannot
// run: no `uv` installed, no network for the first environment build, a sandbox
// that forbids subprocesses. A skip is a normal outcome on a developer machine;
// what would not be normal is this file silently passing while testing nothing,
// so the assertion below names which of the two happened.
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

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { oneOf } from "@ianbicking/tap-check/check";
import { createDoclingService } from "../../../src/services/docling/core.js";
import type { DoclingExtraction } from "../../../src/services/docling/core.js";
import type { Result } from "../../../src/shared/result.js";
import { DOCLING_VERSION } from "../../../src/services/docling/version.js";
import { textPdf } from "../../helpers/pdf-fixtures.js";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
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
  return `uvx/docling ${DOCLING_VERSION} is not runnable here (${probe.message ?? `exit ${String(probe.exitCode)}`})`;
}

const probeSkip = await doclingRunnable();
if (probeSkip) console.warn(`[skipped] pdf-extract-integration: ${probeSkip}`);

// Offline, uncached weights fail inside huggingface_hub's snapshot download.
// That is the one extraction failure that means "not warmed" rather than
// "broken"; every other failure stays a failure.
function weightsMissing(result: Result<DoclingExtraction>) {
  return !result.ok && result.error.includes("huggingface_hub") && /snapshot_download|offline/i.test(result.error);
}

// The request and argv are checked without Docling in
// `test/services/docling/subprocess.test.ts`.

// ## A real extraction over a real PDF
void test("A real extraction over a real PDF", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const dir = await mkdtemp(join(tmpdir(), "docling-real-"));
  const pdfPath = join(dir, "source.pdf");
  await writeFile(pdfPath, textPdf());
  const workDir = join(dir, "work");
  await import("node:fs/promises").then((fs) => fs.mkdir(workDir, { recursive: true }));

  const result: Result<DoclingExtraction> | null = probeSkip
    ? null
    : await createDoclingService().extract(pdfPath, { workDir, ocr: "off", languages: null });
  const skipReason = probeSkip ?? (result !== null && weightsMissing(result) ? "Docling model weights are not in the Hugging Face hub cache" : null);
  if (skipReason && !probeSkip) console.warn(`[skipped] pdf-extract-integration: ${skipReason}`);

  const extracted = result?.ok ? result.value : null;
  const failure = result === null || result.ok ? null : result.error;
  // The checked value: the skipped answer, or what the extraction says when it ran.
  const pick = <T>(skipped: T, ran: (run: DoclingExtraction) => T | undefined): T | undefined => {
    if (skipReason) return skipped;
    return extracted ? ran(extracted) : undefined;
  };

  // One line, whichever path ran — so a skip is visible rather than a silent pass.
  t.check(skipReason ? "SKIPPED" : (extracted ? "EXTRACTED" : `FAILED: ${failure}`), oneOf("SKIPPED", "EXTRACTED"));

  // When it did run, the extraction has the shape the rest of pdf mode relies
  // on: markdown carrying the page's text, a `DoclingDocument` JSON on disk, and one
  // page render per page found by walking the work directory (Docling writes those
  // paths relative to an output root that does not match where the files land, so
  // the walk is load-bearing):

  t.check(pick("Northwind", (run) => (run.markdown.includes("Northwind") ? "Northwind" : run.markdown)), "Northwind");

  // Page renders are PNGs Docling wrote — the WebP re-encode happens a layer up, in
  // `pdf-extract.ts`; one render per page of the one-page fixture.
  t.check(pick(["png"], (run) => run.pageImages.map((image) => image.filePath.split(".").pop())), ["png"]);

  t.check(skipReason ? "DoclingDocument" : (extracted ? JSON.parse(await readFile(extracted.jsonPath, "utf-8")).schema_name : undefined), "DoclingDocument");

  t.check(pick(DOCLING_VERSION, (run) => run.version), DOCLING_VERSION);
});
