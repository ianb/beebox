/**
 * Pdf flow for the scan-import command: a single PDF that already has an
 * embedded text layer is run through Docling and filed as a `pdf.card`
 * (+ the original PDF, the gzipped extraction JSON, and page/figure AVIFs)
 * inside the session's attach scope. No Gemini analysis — the text is already
 * there; Docling contributes layout, reading order, and tables.
 *
 * When extraction fails for any reason, the card is still written — with
 * `status: new`, an `error:` field, and the original PDF as its only asset.
 * That is exactly what this flow did before Docling existed, so a Docling
 * problem degrades to the old behavior instead of blocking intake
 * (`docs/plans/scanner-ingest.md`, Track 4).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { type CommandContext, type CommandResult } from "../command-runner.js";
import { stageAndCommitPaths } from "../../lib/git.js";
import { createCaptureSessionTemplate } from "../../schemas/capture-session.js";
import { createPdfTemplate, type PdfTemplateOptions } from "../../schemas/pdf.js";
import { createOrAppendIntakeJob } from "../../connectors/intake-utils.js";
import { ensureBoxTmpDir } from "../../lib/box-tmp.js";
import { createDoclingService, type DoclingService } from "../../services/docling.js";
import { extractPdf } from "./pdf-extract.js";
import { probePdf } from "./pdf-probe.js";
import { createSessionLayout } from "./scan-import-session.js";

/** Basename of the pdf card and its attach scope inside the session. */
const PDF_BASENAME = "source";
/** Name the original takes inside the pdf card's attach scope. */
const SOURCE_PDF_FILENAME = "source.pdf";

export interface RunPdfModeArgs {
  pdfPath: string;
  /** Injected in tests; production creates the real `uvx docling` wrapper. */
  docling?: DoclingService | undefined;
  /** Provenance from the caller (`scan-upload/<token-name>`), when the run came
   *  from somewhere identifiable. Absent → the generic `scan-import`. */
  source?: string | undefined;
}

export async function runPdfMode(
  ctx: CommandContext,
  args: RunPdfModeArgs
): Promise<CommandResult> {
  const layout = await createSessionLayout(ctx);
  const {
    sessionAttachAbsDir,
    sessionAttachRelDir,
    sessionCardAbsPath,
    sessionCardRelPath,
    sessionId,
    startedAt,
  } = layout;
  ctx.writeLine(`Pdf intake → ${sessionCardRelPath}`);
  ctx.writeLine(`Source: ${args.pdfPath}`);

  // The original lives in the pdf card's own attach scope, alongside
  // everything extraction produces.
  const cardFilename = `${PDF_BASENAME}.pdf.card`;
  const attachRelDir = `${sessionAttachRelDir}/${PDF_BASENAME}.attach`;
  const attachAbsDir = path.join(sessionAttachAbsDir, `${PDF_BASENAME}.attach`);
  await fs.mkdir(attachAbsDir, { recursive: true });
  const pdfDestPath = path.join(attachAbsDir, SOURCE_PDF_FILENAME);
  await fs.copyFile(args.pdfPath, pdfDestPath);
  const stat = await fs.stat(pdfDestPath);

  const probe = await probePdf(pdfDestPath);
  const docling = args.docling ?? createDoclingService();

  const workDir = path.join(await ensureBoxTmpDir(ctx.boxRoot), `pdf-extract-${randomUUID().slice(0, 8)}`);
  await fs.mkdir(workDir, { recursive: true });
  ctx.writeLine("Extracting with Docling...");
  let extraction;
  try {
    extraction = await extractPdf({
      docling,
      sourcePath: pdfDestPath,
      attachAbsDir,
      workDir,
      forceOcr: false,
      languages: null,
    });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }

  const template: PdfTemplateOptions = {
    status: extraction.ok ? "analyzed" : "new",
    format: "pdf",
    capturedAt: startedAt,
    source: args.source ?? "scan-import",
    filename: SOURCE_PDF_FILENAME,
    originalName: path.basename(args.pdfPath),
    mimeType: "application/pdf",
    size: stat.size,
    body: extraction.ok ? extraction.value.body : "",
  };
  const metadata: { pages?: number; title?: string; author?: string } = {};
  if (probe.pages !== undefined) metadata.pages = probe.pages;
  else if (extraction.ok) metadata.pages = extraction.value.pageCount;
  if (probe.title !== undefined) metadata.title = probe.title;
  if (probe.author !== undefined) metadata.author = probe.author;
  if (Object.keys(metadata).length > 0) template.metadata = metadata;

  const assetRelPaths = [`${attachRelDir}/${SOURCE_PDF_FILENAME}`];
  if (extraction.ok) {
    template.doclingFilename = extraction.value.doclingFilename;
    template.doclingVersion = extraction.value.doclingVersion;
    for (const name of extraction.value.assetNames) assetRelPaths.push(`${attachRelDir}/${name}`);
    const imageAssets = extraction.value.assetNames.filter((name) => name.endsWith(".avif")).length;
    ctx.writeLine(`Extracted ${String(extraction.value.pageCount)} page(s), ${String(imageAssets)} image asset(s)`);
  } else {
    template.error = extraction.error;
    // Non-silent by construction: the reason is on the card, not only here.
    console.warn(`[scan-import] Docling extraction failed for ${path.basename(args.pdfPath)}: ${extraction.error}`);
    ctx.writeLine(`Extraction failed (filed as status: new) — ${extraction.error}`);
  }

  await fs.writeFile(path.join(sessionAttachAbsDir, cardFilename), createPdfTemplate(template));

  const sessionCardContent = createCaptureSessionTemplate({
    sessionId,
    startedAt,
    endedAt: startedAt,
    imageRefs: [],
    audioRefs: [],
    fileRefs: [cardFilename],
    source: args.source,
  });
  await fs.writeFile(sessionCardAbsPath, sessionCardContent);

  const filesToStage = [
    ...assetRelPaths,
    `${sessionAttachRelDir}/${cardFilename}`,
    sessionCardRelPath,
  ];
  await stageAndCommitPaths(ctx.boxRoot, {
    paths: filesToStage,
    message: `Pdf import: ${path.basename(args.pdfPath)}`,
    trailers: { "Created-By": "scan-import" },
  });

  const intakeJobPath = await createOrAppendIntakeJob({
    boxRoot: ctx.boxRoot,
    source: "scan",
    items: [sessionCardRelPath],
    description: `Pdf: ${path.basename(args.pdfPath)}`,
  });
  ctx.writeLine(`\nIntake job: ${intakeJobPath}`);
  ctx.writeLine(`Session: ${sessionCardRelPath}`);

  return {
    success: true,
    data: {
      mode: "pdf",
      sessionRelDir: sessionAttachRelDir,
      sessionCardPath: sessionCardRelPath,
      pdfCardPath: `${sessionAttachRelDir}/${cardFilename}`,
      status: template.status,
      intakeJobPath,
    },
  };
}
