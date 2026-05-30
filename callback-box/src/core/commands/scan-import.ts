/**
 * Scan-Import command — turn a scanned PDF, OCR'd document PDF, or batch of
 * scanned JPEGs into a session whose card lands at
 * `box/inbox/scan-<date>-<id>.capture-session.card`. Child cards and files
 * live in the session's attach scope (`scan-….attach/`).
 *
 * Internal dispatch:
 *   - All inputs are images (.jpg/.png/etc) → photo flow with image batch
 *   - Single PDF, no embedded text → photo flow with rendered pages
 *   - Single PDF with embedded text → document mode (no Flash, file the PDF)
 *   - Multiple PDFs or mixed types → error (callers must split)
 *
 * Photo flow output (`<sessionAttach>` = `scan-….attach`):
 *   <sessionAttach>/photo-NNN.image.card + photo-NNN.attach/photo-NNN.jpg
 *     and (optionally) photo-NNN-back.jpg in the same image attach scope
 *   <sessionAttach>/photo-NNN.review.question.card (optional)
 *   <sessionAttach>/orphan-back-NNN.jpg + orphan-back-NNN.question.card
 *   <sessionAttach>/unsure-NNN.jpg + unsure-NNN.question.card
 *   box/inbox/<name>.capture-session.card  (at inbox level)
 *   <sessionAttach>/source.file.card + source.attach/source.pdf
 *     (when imported from a PDF source)
 *
 * Document flow output:
 *   <sessionAttach>/source.file.card + source.attach/source.pdf
 *   box/inbox/<name>.capture-session.card  (no image refs)
 *
 * Internal implementation is split across siblings: `scan-import-session.ts`
 * (layout + input classification), `scan-import-document.ts` (the PDF/document
 * flow), `scan-import-cards.ts` (photo/back/orphan/unsure card emission), and
 * `scan-import-helpers.ts` (Gemini batching + reconciliation).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  registerCommand,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import { createLoader } from "../../cli/lib/loader.js";
import { stageFiles, commit } from "../../cli/lib/git.js";
import { createCaptureSessionTemplate } from "../../schemas/capture-session.js";
import { createOrAppendIntakeJob } from "../../connectors/intake-utils.js";
import {
  runScanBatches,
  resolveScanPages,
  bundleResolvedPages,
} from "./scan-import-helpers.js";
import {
  createSessionLayout,
  readScanContextFile,
  isImageFile,
  isPdfFile,
} from "./scan-import-session.js";
import { runDocumentMode } from "./scan-import-document.js";
import {
  emitPhotoBundle,
  emitOrphanBackQuestion,
  emitUnsureQuestion,
} from "./scan-import-cards.js";

export interface ScanImportArgs {
  inputs: string[];
  context?: string;
}

async function executeScanImport(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const { inputs, context: extraContext } = args as unknown as ScanImportArgs;

  if (!inputs || inputs.length === 0) {
    return { success: false, error: "inputs argument is required (at least one file)" };
  }

  const resolved: string[] = [];
  for (const f of inputs) {
    const abs = path.isAbsolute(f) ? f : path.join(ctx.boxRoot, f);
    try {
      await fs.access(abs);
    } catch (_e) {
      // fs.access rejects when the input path is missing/unreadable — that
      // is precisely the condition we report back to the caller. The error
      // adds no detail beyond the path, so we don't surface it.
      return { success: false, error: `Input file not found: ${abs}` };
    }
    resolved.push(abs);
  }

  const allPdf = resolved.every((f) => isPdfFile(f));
  const allImage = resolved.every((f) => isImageFile(f));
  if (!allPdf && !allImage) {
    return {
      success: false,
      error: "Mixed file types in one scan-import invocation. PDFs run one-per-session; images can be batched together.",
    };
  }

  if (allPdf) {
    if (resolved.length > 1) {
      return {
        success: false,
        error: "scan-import takes a single PDF at a time (use cb upload for batches)",
      };
    }
    // PDFs are always filed as documents — Flash treatment for PDFs is deferred.
    return runDocumentMode(ctx, { pdfPath: resolved[0]! });
  }

  const apiKey = process.env["GEMINI_KEY"] || process.env["SKE_GEMINI_API_KEY"];
  if (!apiKey) {
    return { success: false, error: "GEMINI_KEY environment variable is required" };
  }
  return runPhotoMode(ctx, {
    apiKey,
    imagePaths: resolved,
    extraContext,
  });
}

interface RunPhotoModeArgs {
  apiKey: string;
  imagePaths: string[];
  extraContext: string | undefined;
}

/**
 * Build the combined boxholder context from the optional CLAUDE_SCANS.md file
 * and any `--context` argument, logging which sources contributed.
 */
async function resolveBoxholderContext(
  ctx: CommandContext,
  extraContext: string | undefined
): Promise<string | null> {
  const fileContext = await readScanContextFile(ctx.boxRoot);
  const contextParts: string[] = [];
  if (fileContext) contextParts.push(fileContext.trim());
  if (extraContext && extraContext.trim().length > 0) contextParts.push(extraContext.trim());
  const boxholderContext = contextParts.length > 0 ? contextParts.join("\n\n---\n\n") : null;
  if (boxholderContext) {
    ctx.writeLine(
      `Using boxholder context (${boxholderContext.length} chars${fileContext ? " from CLAUDE_SCANS.md" : ""}${extraContext ? " + --context" : ""})`
    );
  }
  return boxholderContext;
}

async function runPhotoMode(
  ctx: CommandContext,
  args: RunPhotoModeArgs
): Promise<CommandResult> {
  const { apiKey, imagePaths, extraContext } = args;
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
  // the archive copy lives inside the session for safety. Gemini handles
  // ~3000-pixel JPEGs directly, so we send the same files for analysis —
  // no separate API render needed. The scratch dir is removed before commit.
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
  const sourceLabel = `${imagePaths.length} images`;

  const boxholderContext = await resolveBoxholderContext(ctx, extraContext);

  ctx.writeLine(`Analyzing ${apiPages.length} pages with Gemini Flash...`);
  const batchResult = await runScanBatches({
    apiKey,
    imagePaths: apiPages,
    boxholderContext,
    log: (line) => ctx.writeLine(line),
  });
  if (batchResult.failed > 0) ctx.writeLine(`${batchResult.failed} page(s) failed analysis`);
  if (batchResult.usage) {
    ctx.writeLine(
      `Tokens: input=${batchResult.usage.prompt}, output=${batchResult.usage.output}, thinking=${batchResult.usage.thinking}`
    );
  }

  const resolvedPages = resolveScanPages(batchResult.pageAnalyses, apiPages.length);
  const { bundles, orphanBacks, unsurePages, blankPages } = bundleResolvedPages(resolvedPages);
  ctx.writeLine(
    `\nResults: ${bundles.length} photos (${bundles.filter((b) => b.backIndex !== null).length} with backs), ${orphanBacks.length} orphan backs, ${unsurePages.length} unsure, ${blankPages.length} blank`
  );

  const loader = await createLoader(ctx.boxRoot);
  const imageRefs: string[] = [];
  const questionPaths: string[] = [];

  for (const [i, bundle] of bundles.entries()) {
    await emitPhotoBundle({
      loader,
      index: i,
      bundle,
      startedAt,
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
      sessionAttachAbsDir,
      sessionAttachRelDir,
      archivePages,
      filesToStage,
      questionPaths,
    });
  }

  for (const [i, page] of unsurePages.entries()) {
    await emitUnsureQuestion(page, {
      index: i,
      sessionAttachAbsDir,
      sessionAttachRelDir,
      archivePages,
      filesToStage,
      questionPaths,
    });
  }

  await fs.rm(archiveDir, { recursive: true, force: true });

  const sessionCardContent = createCaptureSessionTemplate({
    sessionId,
    startedAt,
    endedAt: startedAt,
    imageRefs,
    audioRefs: [],
    fileRefs: [],
  });
  await fs.writeFile(sessionCardAbsPath, sessionCardContent);
  filesToStage.push(sessionCardRelPath);

  await stageFiles(ctx.boxRoot, filesToStage);
  const summaryParts: string[] = [`${bundles.length} photos`];
  if (orphanBacks.length > 0) summaryParts.push(`${orphanBacks.length} orphan backs`);
  if (unsurePages.length > 0) summaryParts.push(`${unsurePages.length} unsure`);
  await commit(ctx.boxRoot, {
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
  description: "Import an image batch as photo image cards, or a PDF as a document, into box/inbox/scan-…/",
  args: [
    {
      name: "inputs",
      description: "PDF (one) or image files (many) — absolute or relative to box root",
      required: true,
      type: "string[]",
    },
    {
      name: "context",
      description: "Extra context appended to CLAUDE_SCANS.md content for this run",
      required: false,
      type: "string",
    },
  ],
  execute: executeScanImport,
});

export { executeScanImport };
