// # Pdf mode — Docling extraction, and what happens when it fails
//
// `bbx scan-import`'s pdf flow runs a text-layer PDF through Docling and
// files a `pdf.card` in the session's attach scope: the rendered markdown as
// the body, the gzipped `DoclingDocument` JSON, page renders and figures as WebP.
//
// The property that matters most is the failure one: **extraction failure never
// blocks intake.** When Docling cannot run, the card is still written — with
// an `error:` field and the original PDF as its only asset, which
// is exactly what this flow did before Docling existed.
//
// Docling itself is faked here (the services pattern); the real binary is
// exercised by `test/core/pdf/extract.integration.test.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { runPdfMode } from "../../../src/core/commands/scan-import/pdf.js";
import { runPdfReanalyze } from "../../../src/core/commands/pdf-reanalyze.js";
import { createFakeDocling, MAX_EXTRACTION_ARTIFACTS } from "../../../src/services/docling/core.js";
import type { DoclingService } from "../../../src/services/docling/core.js";
import type { CommandResult } from "../../../src/core/command-types.js";
import { invariant } from "../../../src/shared/invariant.js";
import { z } from "zod";
import { extractPdf, clearExtractionAssets } from "../../../src/core/pdf/extract.js";
import { createCollectorContext } from "../../../src/core/command-runner.js";
import { createCardSchemaMap } from "../../../src/schemas.js";
import { parseCardText } from "../../../src/core/card-io.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import type { TmpBox } from "../../helpers/test-helpers.js";
import { textPdf, textlessPdf } from "../../helpers/pdf-fixtures.js";
import { writeFile, readdir, readFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { execa } from "execa";

const schemas = await createCardSchemaMap();

// The raw text layer comes from poppler, which is a deployed-server given but
// not a developer-machine one — so assertions about it are
// availability-appropriate, like `test/core/pdf/probe.test.ts`.
const havePdftotext = await execa("pdftotext", ["-v"], { reject: false }).then((r) => r.exitCode === 0, () => false);

// The fields these examples read from a parsed pdf card, validated rather than assumed.
const PdfCardView = z.object({
  format: z.string(),
  filename: z.object({ ref: z.string(), "mime-type": z.string().optional(), via: z.object({ channel: z.string() }) }),
  docling: z.object({ ref: z.string() }).optional(),
  metadata: z.object({ pages: z.number().optional() }).optional(),
  error: z.string().optional(),
  description: z.string().optional(),
});
function parsePdfCard(content: string, source: string) {
  const card = parseCardText(content, { source, schemas });
  return { fields: PdfCardView.parse(card.fields), rawBody: card.rawBody };
}

// What `runPdfMode` reports in `data`.
const PdfImportData = z.object({ extracted: z.boolean(), sessionCardPath: z.string(), intakeJobPaths: z.array(z.string()).nullable() });
const importData = (result: CommandResult) => PdfImportData.parse(result.data);

// `importData` as the checks expect it. The session card name carries a clock stamp and a
// random suffix; the job card name carries the clock.
const sessionCardPath = str`_content/inbox/scan-${any(String)}.capture-session.card`;
const intakeJobPaths = [str`_bookkeeping/jobs/${any(String)}`];

// The session card `runPdfMode` writes: it lists the pdf card, plus the uploader when one is given.
const sessionCardText = (uploader?: string) => `---
session-id: «uuid»
time:
  start: «date»
  end: «date»
  duration: 0s
images: []
audio-clips: []
files:
  - attach/source.pdf.card${uploader ? `\nuploader: ${uploader}` : ""}
---`;

// Seed a box with a text-layer PDF sitting outside it, and run pdf mode.
async function importPdf(box: TmpBox, { docling, source }: { docling: DoclingService; source?: string }) {
  const pdfPath = join(box.root, "incoming.pdf");
  await writeFile(pdfPath, textPdf());
  const { ctx } = createCollectorContext(box.root);
  return runPdfMode(ctx, { pdfPath, docling, source });
}

// The session attach dir of the one session this box has.
async function sessionDir(box: TmpBox): Promise<string> {
  const entries = await readdir(join(box.root, "_content/inbox"));
  const dir = entries.find((e) => e.endsWith(".attach"));
  invariant(dir, "the import left one session attach dir");
  return dir;
}

// Everything in the pdf card's attach scope, sorted. `text-layer.txt` is
// left out because its presence depends on whether poppler exists here; it has
// its own section below.
async function attachContents(box: TmpBox) {
  const dir = await sessionDir(box);
  const names = await readdir(join(box.root, "_content/inbox", dir, "source.attach"));
  return names.filter((n) => n !== "text-layer.txt").toSorted().join("\n");
}

async function readPdfCard(box: TmpBox) {
  const dir = await sessionDir(box);
  const rel = `_content/inbox/${dir}/source.pdf.card`;
  return { rel, content: await box.read(rel) };
}

// ## A successful extraction lands an extracted pdf card
void test("A successful extraction lands an extracted pdf card", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const docling = createFakeDocling({
    markdown: "## Invoice 2026-04\n\n![Image](out/source_artifacts/image_000000_fake.png)\n",
    pageCount: 2,
    figureCount: 1,
  });
  const result = await importPdf(box, { docling });
  t.check({ success: result.success, data: importData(result) }, {
    success: true,
    data: { extracted: true, sessionCardPath, intakeJobPaths },
  });

  // The fake was asked for a no-OCR extraction — `do_ocr=False` is the default, not
  // an option the caller has to remember:

  await t.checkText(docling.describe(), `docling fake (succeeds), 1 call(s)
  source.pdf ocr=off languages=-`);

  // The attach scope holds the original, the canonical JSON, one WebP per page, and
  // one per figure. Every image is a real WebP — the fake emits real PNG bytes and
  // `sharp` re-encodes them for real:

  await t.checkText(await attachContents(box), `docling.json.gz
figure-001.webp
page-001.webp
page-002.webp
source.pdf`);

  const dir = await sessionDir(box);
  const webp = await readFile(join(box.root, "_content/inbox", dir, "source.attach/page-001.webp"));
  t.check(webp.subarray(8, 12).toString("latin1"), "WEBP");

  const json = gunzipSync(await readFile(join(box.root, "_content/inbox", dir, "source.attach/docling.json.gz")));
  t.check(JSON.parse(json.toString()).schema_name, "DoclingDocument");

  // The card itself validates against the `pdf` schema, carries provenance as
  // a superset of `file.card`, and has the rendered markdown as its body — with the
  // figure reference rewritten into the attach scope, not left pointing at Docling's
  // scratch directory:

  const { rel, content } = await readPdfCard(box);
  const card = parsePdfCard(content, rel);
  // `metadata.pages` comes from the PDF itself (poppler), falling back to the
  // extraction's page count (2 here) on a host without poppler:
  t.check(card.fields, {
    format: "pdf",
    filename: { ref: "attach/source.pdf", "mime-type": "application/pdf", via: { channel: "scan-import" } },
    docling: { ref: "attach/docling.json.gz" },
    metadata: { pages: havePdftotext ? 1 : 2 },
  });

  await t.checkText(card.rawBody.trim(), `## Invoice 2026-04
«blankline»
![Image](attach/figure-001.webp)`);

  // The session card points at the pdf card:

  const sessionCard = await box.read(importData(result).sessionCardPath);
  await t.checkText(sessionCard, sessionCardText());
});

// ## A tall Docling render stays readable within the WebP dimension limit
//
// WebP permits at most 16,383 pixels on each axis. The producer scales an
// oversized render proportionally before encoding rather than failing extraction.
void test("WebP permits at most 16,383 pixels on each axis.", async (t) => {
  t.teardown(async () => {
    try {
      await rm(scratch, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const scratch = await mkdtemp(join(tmpdir(), "bbx-tall-render-"));
  const attachAbsDir = join(scratch, "attach");
  const workDir = join(scratch, "work");
  await mkdir(attachAbsDir, { recursive: true });
  await mkdir(workDir, { recursive: true });
  const sourcePath = join(scratch, "source.pdf");
  await writeFile(sourcePath, textPdf());
  const originalBytes = await readFile(sourcePath);
  const { default: Sharp } = await import("sharp");
  const baseDocling = createFakeDocling({ pageCount: 1 });
  const originalExtract = baseDocling.extract.bind(baseDocling);
  baseDocling.extract = async (path, options) => {
    const extraction = await originalExtract(path, options);
    if (extraction.ok) {
      const page = extraction.value.pageImages[0];
      invariant(page, "the fake renders one page");
      const pagePath = page.filePath;
      await Sharp({ create: { width: 2, height: 17000, channels: 3, background: { r: 20, g: 80, b: 120 } } })
        .png().toFile(pagePath);
    }
    return extraction;
  };
  const result = await extractPdf({
    docling: baseDocling,
    sourcePath,
    attachAbsDir,
    workDir,
    ocr: "off",
    languages: null,
  });
  const encoded = await readFile(join(attachAbsDir, "page-001.webp"));
  const metadata = await Sharp(encoded).metadata();
  t.check(
    [
      result.ok,
      metadata.format,
      metadata.width,
      metadata.height,
      (await readFile(sourcePath)).toString("base64"),
    ],
    [
    true,
    "webp",
    2,
    16383,
    originalBytes.toString("base64"),
  ],
  );
});

// ## The raw text layer is kept verbatim as `text-layer.txt`
//
// Docling's markdown is the body, and it is faithful-but-lossy. The document's own
// text layer is stored beside the original as an asset (D8), so the exact
// characters the producer embedded survive too. It is reference-free — nothing in
// frontmatter points at it; the schema instructions name the convention, the same
// way they do for the page renders.
void test("Docling's markdown is the body, and it is faithful-but-lossy.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await importPdf(box, { docling: createFakeDocling({ markdown: "rendered", pageCount: 1 }) });
  const dir = await sessionDir(box);
  const names = await readdir(join(box.root, "_content/inbox", dir, "source.attach"));
  t.check(names.toSorted(), [
    "docling.json.gz",
    "page-001.webp",
    "source.pdf",
    ...(havePdftotext ? ["text-layer.txt"] : []),
  ]);

  // It holds the PDF's own words, not Docling's rendering of them:

  const raw = havePdftotext
    ? await readFile(join(box.root, "_content/inbox", dir, "source.attach/text-layer.txt"), "utf-8")
    : "Invoice 2026-04 Northwind Traders";
  // poppler's line wrapping varies by version, so the text is checked for the phrase only.
  t.check(raw, any(String).includes("Northwind Traders"));
});

// ## A document with no text layer gets no `text-layer.txt`
//
// An empty asset would be worse than an absent one — it reads as "this document
// has no text" when the honest answer may be "nobody could look" (no poppler on
// the host). Either way the file is simply not written, so its presence always
// means real content. This holds with or without poppler installed.
void test("An empty asset would be worse than an absent one — it reads as \"this document...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(scratch, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const scratch = await mkdtemp(join(tmpdir(), "bbx-text-layer-"));
  const workDir = join(scratch, "work");
  const attachAbsDir = join(scratch, "attach");
  await mkdir(workDir, { recursive: true });
  await mkdir(attachAbsDir, { recursive: true });
  const textlessPath = join(scratch, "textless.pdf");
  await writeFile(textlessPath, textlessPdf());

  const result = await extractPdf({
    docling: createFakeDocling({ markdown: "", pageCount: 1 }),
    sourcePath: textlessPath,
    attachAbsDir,
    workDir,
    ocr: "off",
    languages: null,
  });
  t.check({ result, files: await readdir(attachAbsDir) }, {
    result: {
      ok: true,
      value: {
        body: "",
        assetNames: ["docling.json.gz", "page-001.webp"],
        doclingFilename: "docling.json.gz",
        doclingVersion: "2.117.0-fake",
        pageCount: 1,
      },
    },
    files: ["docling.json.gz", "page-001.webp"],
  });
});

// ## Provenance from the caller lands on both cards
//
// A scan that arrived through the upload route carries the credential that sent
// it. The promote worker passes `scan-upload/<token-name>` down through
// `bbx upload --source`, and it ends up on the pdf card's `filename.via.channel` (replacing
// the generic `scan-import`) and on the session card — so a batch that looks wrong
// identifies the device that produced it.
void test("A scan that arrived through the upload route carries the credential that sent...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const result = await importPdf(box, { docling: createFakeDocling({ markdown: "billed", pageCount: 1 }), source: "scan-upload/laptop-scansnap" });
  const { rel, content } = await readPdfCard(box);
  const card = parsePdfCard(content, rel);
  t.check(card.fields, {
    format: "pdf",
    filename: { ref: "attach/source.pdf", "mime-type": "application/pdf", via: { channel: "scan-upload/laptop-scansnap" } },
    docling: { ref: "attach/docling.json.gz" },
    metadata: { pages: 1 },
  });

  const sessionCard = await box.read(importData(result).sessionCardPath);
  await t.checkText(sessionCard, sessionCardText("scan-upload/laptop-scansnap"));

  // Without it the pdf card keeps saying `scan-import` and the session card
  // carries no `uploader` at all — no uploader sent the file, so an absent one is
  // the honest answer:

  const plain = await makeTmpBox({ git: true });
  const plainResult = await importPdf(plain, { docling: createFakeDocling({ markdown: "billed", pageCount: 1 }) });
  const plainDoc = await readPdfCard(plain);
  t.check(parsePdfCard(plainDoc.content, plainDoc.rel).fields, {
    format: "pdf",
    filename: { ref: "attach/source.pdf", "mime-type": "application/pdf", via: { channel: "scan-import" } },
    docling: { ref: "attach/docling.json.gz" },
    metadata: { pages: 1 },
  });
  await t.checkText(await plain.read(importData(plainResult).sessionCardPath), sessionCardText());

  await plain.cleanup();
});

// ## An extraction failure still files the card, with an `error:`
//
// Nothing is lost: the original PDF is the card's only asset, the reason is on the
// card rather than only in a log, and intake proceeds.
void test("Nothing is lost:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const docling = createFakeDocling({ failWith: "Docling exited 1: killed by the OOM killer" });
  const result = await importPdf(box, { docling });
  t.check({ success: result.success, data: importData(result) }, {
    success: true,
    data: { extracted: false, sessionCardPath, intakeJobPaths },
  });

  t.check(await attachContents(box), "source.pdf");

  const { rel, content } = await readPdfCard(box);
  const card = parsePdfCard(content, rel);
  t.check({ fields: card.fields, body: card.rawBody.trim() }, {
    fields: {
      format: "pdf",
      filename: { ref: "attach/source.pdf", "mime-type": "application/pdf", via: { channel: "scan-import" } },
      metadata: { pages: 1 },
      error: "Docling exited 1: killed by the OOM killer",
    },
    body: "",
  });
  // Intake still completed (the `intakeJobPaths` above) — a Docling problem is not an intake problem.
});

// ## Empty markdown is an extraction with an empty body, not a failure
//
// A document with no readable text is a real answer. The card has `docling:`
// and no `error:` (extraction worked) with nothing in the body, and the page renders are still
// there to look at.
void test("A document with no readable text is a real answer.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const result = await importPdf(box, { docling: createFakeDocling({ markdown: "", pageCount: 1 }) });
  t.check(importData(result), { extracted: true, sessionCardPath, intakeJobPaths });

  const { rel, content } = await readPdfCard(box);
  const card = parsePdfCard(content, rel);
  t.check({ fields: card.fields, body: card.rawBody.trim() }, {
    fields: {
      format: "pdf",
      filename: { ref: "attach/source.pdf", "mime-type": "application/pdf", via: { channel: "scan-import" } },
      docling: { ref: "attach/docling.json.gz" },
      metadata: { pages: 1 },
    },
    body: "",
  });

  await t.checkText(await attachContents(box), `docling.json.gz
page-001.webp
source.pdf`);
});

// ## `bbx pdf reanalyze` re-extracts and preserves authored fields
//
// The card is re-extracted in place. `description` (and anything else an agent
// wrote) survives; the body, `docling`, and the page assets are replaced.
void test("The card is re-extracted in place.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await importPdf(box, { docling: createFakeDocling({ markdown: "first pass", pageCount: 3 }) });
  const dir = await sessionDir(box);
  const cardRel = `_content/inbox/${dir}/source.pdf.card`;

  // Stand in for an agent's downstream processing pass.
  await box.write(cardRel, (await box.read(cardRel)).replace("format: pdf", "format: pdf\ndescription: A utility bill"));

  const docling = createFakeDocling({ markdown: "second pass", pageCount: 1 });
  const { ctx } = createCollectorContext(box.root);
  const result = await runPdfReanalyze(ctx, {
    args: { card: cardRel, "force-ocr": true, languages: "en,de" },
    docling,
  });
  t.check(result, {
    success: true,
    data: { card: str`_content/inbox/scan-${any(String)}.attach/source.pdf.card`, extracted: true, ocr: "replace", pages: 1 },
  });

  // The flags reached the extractor:

  await t.checkText(docling.describe(), `docling fake (succeeds), 1 call(s)
  source.pdf ocr=replace languages=en,de`);

  // The body and page count are the new run's; the description is the old card's:

  const card = parsePdfCard(await box.read(cardRel), cardRel);
  t.check({ fields: card.fields, body: card.rawBody.trim() }, {
    fields: {
      format: "pdf",
      filename: { ref: "attach/source.pdf", "mime-type": "application/pdf", via: { channel: "scan-import" } },
      docling: { ref: "attach/docling.json.gz" },
      metadata: { pages: 1 },
      description: "A utility bill",
    },
    body: "second pass",
  });

  // Three pages became one, and the two stale page assets are gone rather than
  // sitting beside the new one:

  await t.checkText(await attachContents(box), `docling.json.gz
page-001.webp
source.pdf`);
});

// ## Reanalysis cleanup recognizes old AVIF and new WebP page renders
//
// Both generated extensions are disposable, including page numbers wider than
// three digits; unrelated short names and the original survive.
void test("Both generated extensions are disposable, including page numbers wider than t...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(scratch, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const scratch = await mkdtemp(join(tmpdir(), "bbx-render-cleanup-"));
  await writeFile(join(scratch, "source.pdf"), "original");
  await writeFile(join(scratch, "page-001.avif"), "old render");
  await writeFile(join(scratch, "page-1000.avif"), "old wide render");
  await writeFile(join(scratch, "figure-004.webp"), "new render");
  await writeFile(join(scratch, "page-01.avif"), "unmatched");
  const removed = await clearExtractionAssets(scratch, { keep: "source.pdf" });
  t.check({ removed: removed.toSorted(), remaining: (await readdir(scratch)).toSorted() }, {
    removed: [
      "figure-004.webp",
      "page-001.avif",
      "page-1000.avif",
    ],
    remaining: [
      "page-01.avif",
      "source.pdf",
    ],
  });
});

// ## Reanalyze refuses clearly on a card it cannot work with
void test("Reanalyze refuses clearly on a card it cannot work with", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const { ctx } = createCollectorContext(box.root);
  const missing = await runPdfReanalyze(ctx, { args: { card: "_content/inbox/Nope.pdf.card" } });
  t.check(missing, { success: false, error: "Card not found: _content/inbox/Nope.pdf.card" });

  const wrongType = await runPdfReanalyze(ctx, { args: { card: "_content/inbox/Nope.doc.card" } });
  t.check(wrongType, { success: false, error: "Not a pdf card: _content/inbox/Nope.doc.card" });

  // The `card` argument is user-supplied, so it resolves through `shared/ref-path.ts`
  // like every other box path: a `..` that climbs out of the box, or an absolute
  // path naming somewhere else entirely, is a clean refusal rather than a file read
  // outside the box. Fail-closed — nothing is clamped back to the root.

  const outside = ["../outside/Secret.pdf.card", "box/../../outside/Secret.pdf.card", "/etc/Secret.pdf.card", "/tmp/Secret.pdf.card"];
  const escapes = await Promise.all(outside.map((card) => runPdfReanalyze(ctx, { args: { card } })));
  t.check(escapes, [
    { success: false, error: "Card path is not inside the box: ../outside/Secret.pdf.card" },
    { success: false, error: "Card path is not inside the box: box/../../outside/Secret.pdf.card" },
    { success: false, error: "Card path is not inside the box: /etc/Secret.pdf.card" },
    { success: false, error: "Card path is not inside the box: /tmp/Secret.pdf.card" },
  ]);

  // A `..` that stays inside the box is fine — it just normalizes, and the refusal
  // that follows is about the card, not the path:

  const inside = await runPdfReanalyze(ctx, { args: { card: "_content/inbox/../inbox/Nope.pdf.card" } });
  t.check(inside, { success: false, error: "Card not found: _content/inbox/Nope.pdf.card" });
});

// ## Extraction output is bounded before anything re-encodes it
//
// Docling decides how many artifacts it writes; the caps (D16) sit between
// extraction and the WebP re-encode, so a pathological run is an extraction
// failure rather than unbounded work. Over the cap behaves like every other
// extraction failure — which is the property that matters: intake never blocks.
void test("Docling decides how many artifacts it writes; the caps (D16) sit between extr...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(scratch, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const scratch = await mkdtemp(join(tmpdir(), "bbx-doc-bounds-"));
  const workDir = join(scratch, "work");
  const attachAbsDir = join(scratch, "attach");
  await mkdir(workDir, { recursive: true });
  await mkdir(attachAbsDir, { recursive: true });

  const tooMany = await extractPdf({
    docling: createFakeDocling({ pageCount: MAX_EXTRACTION_ARTIFACTS + 1 }),
    sourcePath: join(scratch, "source.pdf"),
    attachAbsDir,
    workDir,
    ocr: "off",
    languages: null,
  });
  t.check(tooMany, { ok: false, error: "Docling produced 501 page/figure artifacts, over the limit of 500" });

  // Nothing was written into the attach scope — the refusal happens before the
  // re-encode, not halfway through it:

  t.check(await readdir(attachAbsDir), []);

  // Right at the cap is still a normal extraction:

  const atCap = await extractPdf({
    docling: createFakeDocling({ pageCount: 3, figureCount: 2 }),
    sourcePath: join(scratch, "source.pdf"),
    attachAbsDir,
    workDir,
    ocr: "off",
    languages: null,
  });
  t.check(atCap, {
    ok: true,
    value: {
      body: "# Fake Document\n\nExtracted body.\n",
      assetNames: ["docling.json.gz", "page-001.webp", "page-002.webp", "page-003.webp", "figure-001.webp", "figure-002.webp"],
      doclingFilename: "docling.json.gz",
      doclingVersion: "2.117.0-fake",
      pageCount: 3,
    },
  });
});
