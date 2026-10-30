// # Which route a scanned PDF takes
//
// A scanned PDF is a document. It used to be routed on whether it carried a text
// layer: one with text became a `pdf.card`, one without was assumed to be a batch
// of photographs wrapped in a PDF and sent through the photo flow.
//
// That made a scanner setting decide the pipeline. The same paperwork scanned
// with "searchable PDF" turned off became photo pages, each raising a `photo |
// back-of-photo | trash` question that no answer fit — and one real document was
// trashed unfiled, because triage had nothing but that question to work from.
// Whether a text layer exists says how to *get* the text, not what the material
// *is*.
//
// So a PDF now goes to pdf mode either way, and pdf mode turns on Docling's OCR
// when there is no text layer to read. The photo flow keeps the material it was
// built for: batches of image files, and a PDF the caller explicitly says is
// photos.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { execa } from "execa";
import { createFakeDocling } from "../../../../src/services/docling/core.js";
import { runPdfMode } from "../../../../src/core/commands/scan-import/pdf.js";
import { createCollectorContext } from "../../../../src/core/command-runner.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import type { TmpBox } from "../../../helpers/test-helpers.js";
import { isRecord } from "../../../../src/shared/is-record.js";
import { textPdf, textlessPdf } from "../../../helpers/pdf-fixtures.js";

// Annex-converted boxes only: scan-import stages raw asset bytes, which a
// manifest-scheme box gitignores (issues/closed/bugs/2026-09-04-scan-import-gitignore-
// blocks-attach-staging.md).
// The OCR decision reads the PDF's text layer, which needs poppler.
const havePdftotext = await execa("pdftotext", ["-v"], { reject: false }).then(
  (r) => r.exitCode === 0,
  () => false,
);

async function importPdf(box: TmpBox, bytes: Parameters<typeof writeFile>[1]) {
  const pdfPath = join(box.root, "incoming.pdf");
  await writeFile(pdfPath, bytes);
  const docling = createFakeDocling({ markdown: "# Scan\n", pageCount: 1, figureCount: 0 });
  const { ctx } = createCollectorContext(box.root);
  const outcome = await runPdfMode(ctx, { pdfPath, docling });
  // `data` is `unknown` on a CommandResult; the checks below read named fields off it.
  return { result: { ...outcome, data: isRecord(outcome.data) ? outcome.data : {} }, docling };
}

/** A completed PDF import: the session paths vary (timestamp and random suffix). */
const PDF_IMPORTED = {
  success: true,
  data: {
    mode: "pdf",
    sessionRelDir: str`_content/inbox/scan-${any(String)}.attach`,
    sessionCardPath: str`_content/inbox/scan-${any(String)}.capture-session.card`,
    pdfCardPath: str`_content/inbox/scan-${any(String)}.attach/source.pdf.card`,
    extracted: true,
    intakeJobPaths: [any(String).matches(/^_bookkeeping\/jobs\/.+-inbox-[\da-f]{8}\.intake\.job\.card$/)],
  },
};

// ## A PDF with no text layer is still a document — and Docling is told to OCR it
//
// The card is a `pdf.card`, not a set of photo cards, and the extraction ran OCR
// over the layout's regions, because there was no text layer to read.
void test("The card is a pdf.card, not a set of photo cards, and the extraction ran OCR...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const { result, docling } = await importPdf(box, textlessPdf());
  t.check(result, PDF_IMPORTED);

  if (havePdftotext) {
    t.check(docling.calls, [{ sourcePath: str`${box.root}/_content/inbox/${any(String)}/source.attach/source.pdf`, ocr: "regions", languages: null }]);
  }
});

// ## A PDF that already carries text is left alone
//
// A good text layer beats re-OCRing an image of itself. (A layer that is present
// but junk is a third case — see `test/core/pdf/probe.test.ts`.)
void test("A good text layer beats re-OCRing an image of itself.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const { result, docling } = await importPdf(box, textPdf());
  t.check(result, PDF_IMPORTED);

  if (havePdftotext) {
    t.check(docling.calls, [{ sourcePath: str`${box.root}/_content/inbox/${any(String)}/source.attach/source.pdf`, ocr: "off", languages: null }]);
  }
});

// ## Neither route raises a photo-taxonomy question for a document
//
// The concrete regression this guards: a document page reaching a question whose
// only options are photo, back-of-photo, or trash, with delete as the fallback.
void test("The concrete regression this guards:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const { result } = await importPdf(box, textlessPdf());
  t.check(result, PDF_IMPORTED);
});
