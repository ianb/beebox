/**
 * Scan-Import command — turn a scanned PDF, OCR'd document PDF, or batch of
 * scanned JPEGs into a session whose card lands at
 * `_content/inbox/scan-<date>-<id>.capture-session.card`. Child cards and files
 * live in the session's attach scope (`scan-….attach/`).
 *
 * Internal dispatch (the PDF branch probes for a text layer — `pdf-probe.ts`):
 *   - All inputs are images (.jpg/.png/etc) → photo flow with image batch
 *   - Single PDF, no embedded text → photo flow with `pdftoppm`-rendered pages
 *   - Single PDF with embedded text → pdf mode (Docling extraction)
 *   - Multiple PDFs or mixed types → error (callers must split)
 *
 * Photo flow output (`<sessionAttach>` = `scan-….attach`):
 *   <sessionAttach>/photo-NNN.image.card + photo-NNN.attach/photo-NNN.jpg
 *     and (optionally) photo-NNN-back.jpg in the same image attach scope
 *   <sessionAttach>/orphan-back-NNN.jpg, unsure-NNN.jpg  (loose JPEGs stay here)
 *   box/questions/<session-slug>-photo-NNN.review.question.card (optional)
 *   box/questions/<session-slug>-orphan-back-NNN.question.card
 *   box/questions/<session-slug>-unsure-NNN.question.card
 *   _content/inbox/<name>.capture-session.card  (at inbox level)
 *   <sessionAttach>/source.file.card + source.attach/source.pdf
 *     (when imported from a PDF source)
 *
 * Question cards live in `_bookkeeping/questions/`, not the attach scope, so the
 * system's pending/notification/aging machinery (which only scans
 * `_bookkeeping/questions/`) sees them; each carries a `context:` ref back into the
 * attach scope for the item it's about.
 *
 * Pdf flow output:
 *   <sessionAttach>/source.pdf.card
 *     + source.attach/{source.pdf, docling.json.gz, page-NNN.avif, figure-NNN.avif}
 *   _content/inbox/<name>.capture-session.card  (no image refs)
 *
 * Internal implementation is split across siblings: `scan-import-session.ts`
 * (layout + input classification + vision-backend selection),
 * `scan-import-pdf.ts` (the PDF/pdf flow), `scan-import-cards.ts`
 * (photo/back/orphan/unsure card emission), and `scan-import-helpers.ts`
 * (vision batching + reconciliation). The analysis backend itself is the
 * ScanVision service (`src/services/scan-vision.ts` — Claude default,
 * Gemini opt-in).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  registerCommand,
  parseCommandArgs,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import { createCardSchemaMap } from "../../schemas/registry.js";
import { stageAndCommitPaths } from "../../lib/git.js";
import { createCaptureSessionTemplate } from "../../schemas/capture-session.js";
import { createOrAppendIntakeJob } from "../../connectors/intake-utils.js";
import { resolveScanPages, bundleResolvedPages } from "./scan-import-helpers.js";
import { type ScanVisionService } from "../../services/scan-vision.js";
import {
  createSessionLayout,
  fileSessionSourcePdf,
  resolveBoxholderContext,
  resolveScanInputs,
  resolveScanVision,
  analyzeScanPages,
} from "./scan-import-session.js";
import { runPdfMode } from "./scan-import-pdf.js";
import { ensureBoxTmpDir } from "../../lib/box-tmp.js";
import { PdfRenderError, probePdf, renderPdfPages } from "./pdf-probe.js";
import {
  emitPhotoBundle,
  emitOrphanBackQuestion,
  emitUnsureQuestion,
} from "./scan-import-cards.js";

const ScanImportArgsSchema = z.object({
  inputs: z.array(z.string()).optional(),
  context: z.string().optional(),
  /** Free-text provenance recorded on the cards this run produces. The scan
   *  promote worker passes `scan-upload/<token-name>`; the shape is a
   *  convention, not a validated format. */
  source: z.string().optional(),
  /** Override the material this run is treated as. A single PDF is a document
   *  by default; `photos` sends it through the photo flow instead, which is
   *  how a scanned photo album gets front/back pairing. Absent means the
   *  default route for the inputs. */
  mode: z.enum(["document", "photos"]).optional(),
});
export type ScanImportArgs = z.infer<typeof ScanImportArgsSchema>;

async function executeScanImport(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const { inputs, context: extraContext, source, mode } = parseCommandArgs(args, ScanImportArgsSchema);

  if (!inputs || inputs.length === 0) {
    return { success: false, error: "inputs argument is required (at least one file)" };
  }

  const resolved = await resolveScanInputs(ctx.boxRoot, inputs);
  if ("error" in resolved) return { success: false, error: resolved.error };

  if (resolved.kind === "pdf") {
    // A PDF is a document unless the caller says otherwise.
    //
    // This used to branch on whether the PDF carried a text layer, sending
    // textless ones to the photo flow on the assumption that they were photo
    // batches wrapped in a PDF. That made a scanner's OCR checkbox decide
    // which pipeline a document took: the same paperwork scanned with
    // "searchable PDF" off became photo pages, each raising a `photo |
    // back-of-photo | trash` question no answer fit — and one document was
    // trashed unfiled because triage had only that question to work from.
    // Whether a text layer exists says how to GET the text, not what the
    // material IS; pdf mode now OCRs when there is no layer to read.
    if (mode !== "photos") {
      if (mode === "document") ctx.writeLine("Mode: document → pdf mode");
      else {
        const probe = await probePdf(resolved.pdfPath);
        ctx.writeLine(
          probe.hasTextLayer
            ? `PDF has a text layer (${probe.textLayerSource}) → pdf mode`
            : "PDF has no text layer → pdf mode with OCR",
        );
      }
      return runPdfMode(ctx, { pdfPath: resolved.pdfPath, source });
    }
    ctx.writeLine("Mode: photos → rendering pages for photo analysis");
    return runPhotoModeFromPdf(ctx, { pdfPath: resolved.pdfPath, extraContext, source });
  }

  const visionOrError = await resolveScanVision(ctx.boxRoot);
  if ("error" in visionOrError) return { success: false, error: visionOrError.error };
  return runPhotoMode(ctx, {
    vision: visionOrError.vision,
    imagePaths: resolved.imagePaths,
    sourcePdfPath: null,
    extraContext,
    source,
  });
}


/**
 * Textless PDF → page images → the existing photo flow. The renders are
 * scratch (photo mode copies what it needs); the PDF itself is filed in the
 * session so the original is never only-in-the-renders.
 */
async function runPhotoModeFromPdf(
  ctx: CommandContext,
  args: { pdfPath: string; extraContext: string | undefined; source: string | undefined }
): Promise<CommandResult> {
  const visionOrError = await resolveScanVision(ctx.boxRoot);
  if ("error" in visionOrError) return { success: false, error: visionOrError.error };
  const renderDir = path.join(
    await ensureBoxTmpDir(ctx.boxRoot),
    `scan-render-${randomUUID().slice(0, 8)}`
  );
  try {
    const imagePaths = await renderPdfPages(args.pdfPath, { outDir: renderDir });
    ctx.writeLine(`Rendered ${String(imagePaths.length)} page(s)`);
    return await runPhotoMode(ctx, {
      vision: visionOrError.vision,
      imagePaths,
      sourcePdfPath: args.pdfPath,
      extraContext: args.extraContext,
      source: args.source,
    });
  } catch (e) {
    if (e instanceof PdfRenderError) return { success: false, error: e.message };
    throw e;
  } finally {
    await fs.rm(renderDir, { recursive: true, force: true });
  }
}

interface RunPhotoModeArgs {
  vision: ScanVisionService;
  imagePaths: string[];
  /** The PDF the images were rendered from, filed as the session's source. */
  sourcePdfPath: string | null;
  extraContext: string | undefined;
  /** Provenance string for the session card (`scan-upload/<token-name>`). */
  source: string | undefined;
}

async function runPhotoMode(
  ctx: CommandContext,
  args: RunPhotoModeArgs
): Promise<CommandResult> {
  const { vision, imagePaths, sourcePdfPath, extraContext, source } = args;
  const layout = await createSessionLayout(ctx);
  const {
    sessionAttachRelDir,
    sessionAttachAbsDir,
    sessionCardAbsPath,
    sessionCardRelPath,
    sessionId,
    startedAt,
  } = layout;
  ctx.writeLine(`Photo intake → ${sessionCardRelPath}`);
  ctx.writeLine(`Source: ${imagePaths.length} image file(s)`);

  const filesToStage: string[] = [];

  // Copy each input into a scratch dir so the originals stay untouched and
  // the archive copy lives inside the session for safety. The shared batch
  // runner derives bounded JPEGs from these archive copies for either vision
  // backend. The archive dir is removed after its originals are filed.
  const archiveDir = path.join(sessionAttachAbsDir, ".scan-archive");
  await fs.mkdir(archiveDir, { recursive: true });
  const archivePages: string[] = [];
  for (const [i, src] of imagePaths.entries()) {
    const idx = String(i + 1).padStart(3, "0");
    const dst = path.join(archiveDir, `page-${idx}${path.extname(src).toLowerCase()}`);
    await fs.copyFile(src, dst);
    archivePages.push(dst);
  }
  const apiPages = archivePages;
  const sourceLabel = sourcePdfPath === null
    ? `${imagePaths.length} images`
    : `${path.basename(sourcePdfPath)} (${imagePaths.length} rendered pages)`;

  // A textless PDF's renders are derived data; the PDF is the original, so it
  // is filed as a `file.card` in the session rather than discarded.
  const fileRefs: string[] = [];
  if (sourcePdfPath !== null) {
    const filed = await fileSessionSourcePdf({
      sourcePdfPath,
      sessionAttachAbsDir,
      sessionAttachRelDir,
      startedAt,
    });
    filesToStage.push(...filed.filesToStage);
    fileRefs.push(...filed.fileRefs);
  }

  const boxholderContext = await resolveBoxholderContext(ctx, extraContext);

  const analysisOutcome = await analyzeScanPages(ctx, { vision, apiPages, boxholderContext, sessionAttachAbsDir });
  if ("error" in analysisOutcome) return { success: false, error: analysisOutcome.error };
  const { batchResult } = analysisOutcome;

  const resolvedPages = resolveScanPages(batchResult.pageAnalyses, apiPages.length);
  const { bundles, orphanBacks, unsurePages, blankPages } = bundleResolvedPages(resolvedPages);
  ctx.writeLine(
    `\nResults: ${bundles.length} photos (${bundles.filter((b) => b.backIndex !== null).length} with backs), ${orphanBacks.length} orphan backs, ${unsurePages.length} unsure, ${blankPages.length} blank`
  );

  const cardSchemas = await createCardSchemaMap(ctx.boxRoot);
  const imageRefs: string[] = [];
  const questionPaths: string[] = [];

  for (const [i, bundle] of bundles.entries()) {
    await emitPhotoBundle({
      cardSchemas,
      index: i,
      bundle,
      startedAt,
      boxRoot: ctx.boxRoot,
      sessionAttachAbsDir,
      sessionAttachRelDir,
      archivePages,
      filesToStage,
      imageRefs,
      questionPaths,
    });
  }

  for (const [i, orphan] of orphanBacks.entries()) {
    await emitOrphanBackQuestion(orphan, {
      index: i,
      boxRoot: ctx.boxRoot,
      sessionAttachAbsDir,
      sessionAttachRelDir,
      archivePages,
      filesToStage,
      questionPaths,
      askedAt: startedAt,
    });
  }

  for (const [i, page] of unsurePages.entries()) {
    await emitUnsureQuestion(page, {
      index: i,
      boxRoot: ctx.boxRoot,
      sessionAttachAbsDir,
      sessionAttachRelDir,
      archivePages,
      filesToStage,
      questionPaths,
      askedAt: startedAt,
    });
  }

  await fs.rm(archiveDir, { recursive: true, force: true });

  const sessionCardContent = createCaptureSessionTemplate({
    sessionId,
    startedAt,
    endedAt: startedAt,
    imageRefs,
    audioRefs: [],
    fileRefs,
    source,
  });
  await fs.writeFile(sessionCardAbsPath, sessionCardContent);
  filesToStage.push(sessionCardRelPath);

  const summaryParts: string[] = [`${bundles.length} photos`];
  if (orphanBacks.length > 0) summaryParts.push(`${orphanBacks.length} orphan backs`);
  if (unsurePages.length > 0) summaryParts.push(`${unsurePages.length} unsure`);
  await stageAndCommitPaths(ctx.boxRoot, {
    paths: filesToStage,
    message: `Scan import: ${summaryParts.join(", ")}`,
    trailers: { "Created-By": "scan-import" },
  });

  const intakeItems = [sessionCardRelPath, ...questionPaths];
  const intakeDescription = `Scan from ${sourceLabel}: ${bundles.length} photo${bundles.length === 1 ? "" : "s"}${questionPaths.length > 0 ? `, ${questionPaths.length} review question${questionPaths.length === 1 ? "" : "s"}` : ""}`;
  const intakeJobPath = await createOrAppendIntakeJob({
    boxRoot: ctx.boxRoot,
    source: "scan",
    items: intakeItems,
    description: intakeDescription,
  });
  ctx.writeLine(`\nIntake job: ${intakeJobPath}`);
  ctx.writeLine(`Session: ${sessionCardRelPath}`);

  return {
    success: true,
    data: {
      mode: "photo",
      sessionRelDir: sessionAttachRelDir,
      sessionCardPath: sessionCardRelPath,
      photoCount: bundles.length,
      pairedCount: bundles.filter((b) => b.backIndex !== null).length,
      orphanBackCount: orphanBacks.length,
      unsureCount: unsurePages.length,
      blankCount: blankPages.length,
      reviewQuestions: questionPaths.length,
      intakeJobPath,
    },
  };
}

registerCommand({
  name: "scan-import",
  description: "Import an image batch as photo image cards, or a PDF as a pdf card, into _content/inbox/scan-…/",
  args: [
    {
      name: "inputs",
      description: "PDF (one) or image files (many) — absolute or relative to box root",
      required: true,
      type: "string[]",
    },
    {
      name: "mode",
      description:
        "document (default for a PDF) or photos — use photos for a scanned photo album, " +
        "where front/back pairing applies",
      required: false,
      type: "string",
    },
    {
      name: "context",
      description: "Extra context appended to the scan-guide context for this run",
      required: false,
      type: "string",
    },
    {
      name: "source",
      description: "Provenance recorded on the produced cards (e.g. scan-upload/<token-name>)",
      required: false,
      type: "string",
    },
  ],
  execute: executeScanImport,
});

export { runPhotoMode };
