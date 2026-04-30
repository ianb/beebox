/**
 * Scan-Import command — turn a scanned PDF, OCR'd document PDF, or batch of
 * scanned JPEGs into a session in `box/inbox/scan-…/`.
 *
 * Internal dispatch:
 *   - All inputs are images (.jpg/.png/etc) → photo flow with image batch
 *   - Single PDF, no embedded text → photo flow with rendered pages
 *   - Single PDF with embedded text → document mode (no Flash, file the PDF)
 *   - Multiple PDFs or mixed types → error (callers must split)
 *
 * Photo flow output:
 *   <session>/photo-NNN.jpg + .image.card (Flash-analyzed)
 *   <session>/photo-NNN-back.jpg when paired
 *   <session>/orphan-back-NNN.jpg + question
 *   <session>/unsure-NNN.jpg + question
 *   <session>/<name>.capture-session.card
 *   <session>/source.pdf + source.file.card  (PDF source only)
 *
 * Document flow output:
 *   <session>/source.pdf + source.file.card
 *   <session>/<name>.capture-session.card  (no image refs)
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  registerCommand,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import { createLoader } from "../../cli/lib/loader.js";
import { stageFiles, commit } from "../../cli/lib/git.js";
import { getBoxTimeISO } from "../../cli/lib/time.js";
import { createImageTemplate } from "../../schemas/image.js";
import { createCaptureSessionTemplate } from "../../schemas/capture-session.js";
import { createFileTemplate } from "../../schemas/file.js";
import { createTextQuestionTemplate } from "../../schemas/question.js";
import { createOrAppendIntakeJob } from "../../connectors/intake-utils.js";
import {
  PDF_EXTENSION,
  SUPPORTED_IMAGE_EXTENSIONS,
} from "./upload-helpers.js";
import {
  detectPdfNeedsFlash,
  renderPdfPages,
  runScanBatches,
  resolveScanPages,
  bundleResolvedPages,
  type PhotoBundle,
} from "./scan-import-helpers.js";

export interface ScanImportArgs {
  inputs: string[];
  archiveDpi?: number;
  apiScaleTo?: number;
  context?: string;
  treatAs?: "scan" | "document";
}

interface SessionLayout {
  sessionId: string;
  sessionDirName: string;
  sessionRelDir: string;
  sessionAbsDir: string;
  sessionCardFilename: string;
  startedAt: string;
}

type PhotoSource =
  | { kind: "pdf"; pdfPath: string; archiveDpi: number; apiScaleTo: number }
  | { kind: "images"; imagePaths: string[] };

const isImageFile = (p: string): boolean =>
  SUPPORTED_IMAGE_EXTENSIONS.includes(path.extname(p).toLowerCase());
const isPdfFile = (p: string): boolean =>
  path.extname(p).toLowerCase() === PDF_EXTENSION;

async function readScanContextFile(boxRoot: string): Promise<string | null> {
  for (const name of ["CLAUDE_SCANS.md", "claude_scans.md"]) {
    try {
      const content = await fs.readFile(path.join(boxRoot, name), "utf-8");
      if (content.trim().length > 0) return content;
    } catch {
      // try next candidate
    }
  }
  return null;
}

async function createSessionLayout(ctx: CommandContext): Promise<SessionLayout> {
  const sessionId = randomUUID();
  const shortId = sessionId.slice(0, 8);
  const startedAt = getBoxTimeISO(ctx.boxRoot);
  const stamp = startedAt.replace(/[:-]/g, "").slice(0, 13);
  const formattedDate = `${stamp.slice(0, 8)}T${stamp.slice(9, 13)}`;
  const sessionDirName = `scan-${formattedDate}-${shortId}`;
  const sessionRelDir = `box/inbox/${sessionDirName}`;
  const sessionAbsDir = path.join(ctx.boxRoot, sessionRelDir);
  await fs.mkdir(sessionAbsDir, { recursive: true });
  return {
    sessionId,
    sessionDirName,
    sessionRelDir,
    sessionAbsDir,
    sessionCardFilename: `${sessionDirName}.capture-session.card`,
    startedAt,
  };
}

async function executeScanImport(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const {
    inputs,
    archiveDpi = 600,
    apiScaleTo = 2000,
    context: extraContext,
    treatAs,
  } = args as unknown as ScanImportArgs;

  if (!inputs || inputs.length === 0) {
    return { success: false, error: "inputs argument is required (at least one file)" };
  }

  const resolved: string[] = [];
  for (const f of inputs) {
    const abs = path.isAbsolute(f) ? f : path.join(ctx.boxRoot, f);
    try {
      await fs.access(abs);
    } catch {
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

  const apiKey = process.env["GEMINI_KEY"] || process.env["SKE_GEMINI_API_KEY"];

  if (allPdf) {
    if (resolved.length > 1) {
      return {
        success: false,
        error: "scan-import takes a single PDF at a time (use cb upload for batches)",
      };
    }
    const pdfPath = resolved[0]!;

    let mode: "photo" | "document";
    if (treatAs === "scan") mode = "photo";
    else if (treatAs === "document") mode = "document";
    else {
      ctx.writeLine(`Detecting PDF mode for ${path.basename(pdfPath)}...`);
      try {
        const det = await detectPdfNeedsFlash(pdfPath);
        ctx.writeLine(
          `  pages=${det.pageCount}, chars/page=${det.charsPerPage.toFixed(1)} → ${det.needsFlash ? "photo (scanned)" : "document (text-bearing)"}`
        );
        mode = det.needsFlash ? "photo" : "document";
      } catch (e) {
        return { success: false, error: `PDF mode detection failed: ${(e as Error).message}` };
      }
    }

    if (mode === "document") {
      return runDocumentMode(ctx, { pdfPath });
    }
    if (!apiKey) {
      return { success: false, error: "GEMINI_KEY environment variable is required for photo flow" };
    }
    return runPhotoMode(ctx, {
      apiKey,
      source: { kind: "pdf", pdfPath, archiveDpi, apiScaleTo },
      extraContext,
    });
  }

  // All-image path
  if (!apiKey) {
    return { success: false, error: "GEMINI_KEY environment variable is required" };
  }
  return runPhotoMode(ctx, {
    apiKey,
    source: { kind: "images", imagePaths: resolved },
    extraContext,
  });
}

interface MaterializeArgs {
  source: PhotoSource;
  scratchArchiveDir: string;
  scratchApiDir: string;
}

async function materializePhotoSource(
  ctx: CommandContext,
  { source, scratchArchiveDir, scratchApiDir }: MaterializeArgs
): Promise<
  | { ok: true; archivePages: string[]; apiPages: string[]; sourceLabel: string; sourceFileRef: string | null; sourceStaged: string[] }
  | { ok: false; error: string }
> {
  if (source.kind === "pdf") {
    ctx.writeLine(`Source PDF: ${source.pdfPath}`);
    ctx.writeLine(`Rendering archive copies at ${source.archiveDpi}dpi...`);
    const archivePages = await renderPdfPages({
      pdfPath: source.pdfPath,
      outDir: scratchArchiveDir,
      prefix: "page",
      mode: { dpi: source.archiveDpi },
    });
    ctx.writeLine(`  ${archivePages.length} pages rendered`);
    ctx.writeLine(`Rendering API copies at scale-to=${source.apiScaleTo}...`);
    const apiPages = await renderPdfPages({
      pdfPath: source.pdfPath,
      outDir: scratchApiDir,
      prefix: "page",
      mode: { scaleTo: source.apiScaleTo },
      jpegQuality: 85,
    });
    ctx.writeLine(`  ${apiPages.length} pages rendered`);
    if (archivePages.length !== apiPages.length) {
      return {
        ok: false,
        error: `Page count mismatch between archive (${archivePages.length}) and API (${apiPages.length}) renders`,
      };
    }
    return {
      ok: true,
      archivePages,
      apiPages,
      sourceLabel: path.basename(source.pdfPath),
      sourceFileRef: "source.file.card",
      sourceStaged: ["source.pdf", "source.file.card"],
    };
  }

  ctx.writeLine(`Source: ${source.imagePaths.length} image file(s)`);
  await fs.mkdir(scratchArchiveDir, { recursive: true });
  const archivePages: string[] = [];
  for (const [i, src] of source.imagePaths.entries()) {
    const idx = String(i + 1).padStart(3, "0");
    const dst = path.join(scratchArchiveDir, `page-${idx}${path.extname(src).toLowerCase()}`);
    await fs.copyFile(src, dst);
    archivePages.push(dst);
  }
  // No API copy — Gemini handles ~3000-pixel JPEGs fine; saves a render step.
  return {
    ok: true,
    archivePages,
    apiPages: archivePages,
    sourceLabel: `${source.imagePaths.length} images`,
    sourceFileRef: null,
    sourceStaged: [],
  };
}

interface RunPhotoModeArgs {
  apiKey: string;
  source: PhotoSource;
  extraContext: string | undefined;
}

async function runPhotoMode(
  ctx: CommandContext,
  args: RunPhotoModeArgs
): Promise<CommandResult> {
  const { apiKey, source, extraContext } = args;
  const layout = await createSessionLayout(ctx);
  const { sessionAbsDir, sessionRelDir, sessionCardFilename, sessionId, startedAt } = layout;
  ctx.writeLine(`Photo intake → ${sessionRelDir}`);

  const filesToStage: string[] = [];

  // Write source.pdf + source.file.card up front so they're recoverable even if
  // we crash mid-flow.
  if (source.kind === "pdf") {
    await fs.copyFile(source.pdfPath, path.join(sessionAbsDir, "source.pdf"));
    const stat = await fs.stat(path.join(sessionAbsDir, "source.pdf"));
    const fileCard = createFileTemplate({
      capturedAt: startedAt,
      source: "scan-import",
      filename: "source.pdf",
      originalName: path.basename(source.pdfPath),
      mimeType: "application/pdf",
      size: stat.size,
    });
    await fs.writeFile(path.join(sessionAbsDir, "source.file.card"), fileCard);
  }

  const archiveDir = path.join(sessionAbsDir, ".scan-archive");
  const apiDir = path.join(sessionAbsDir, ".scan-api");
  const mat = await materializePhotoSource(ctx, {
    source,
    scratchArchiveDir: archiveDir,
    scratchApiDir: apiDir,
  });
  if (!mat.ok) return { success: false, error: mat.error };
  const { archivePages, apiPages, sourceLabel, sourceFileRef } = mat;
  for (const f of mat.sourceStaged) filesToStage.push(`${sessionRelDir}/${f}`);

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
    const photoIdx = String(i + 1).padStart(3, "0");
    const photoBasename = `photo-${photoIdx}`;
    const photoFilename = `${photoBasename}.jpg`;
    const cardFilename = `${photoBasename}.image.card`;

    await fs.rename(archivePages[bundle.photoIndex]!, path.join(sessionAbsDir, photoFilename));
    filesToStage.push(`${sessionRelDir}/${photoFilename}`);

    let backFilename: string | null = null;
    if (bundle.backIndex !== null) {
      backFilename = `${photoBasename}-back.jpg`;
      await fs.rename(archivePages[bundle.backIndex]!, path.join(sessionAbsDir, backFilename));
      filesToStage.push(`${sessionRelDir}/${backFilename}`);
    }

    const cardContent = createImageTemplate({
      capturedAt: startedAt,
      source: "gallery",
      filename: photoFilename,
    });
    const cardPath = path.join(sessionAbsDir, cardFilename);
    await fs.writeFile(cardPath, cardContent);
    await applyBundleAnalysisToCard(loader, { cardPath, bundle });
    filesToStage.push(`${sessionRelDir}/${cardFilename}`);
    imageRefs.push(cardFilename);

    if (bundle.flagForReview) {
      const memo = [
        `Photo ${photoIdx} (page ${bundle.photoIndex + 1}${bundle.backIndex !== null ? `, back on page ${bundle.backIndex + 1}` : ""}) needs review:`,
        ...bundle.flagReasons.map((r) => `- ${r}`),
      ].join("\n");
      const directiveParts = [`Open ${sessionRelDir}/${cardFilename} and adjust description or text blocks.`];
      if (backFilename) {
        directiveParts.push(`Cross-check the back transcription against ${sessionRelDir}/${backFilename}.`);
      }
      const questionContent = createTextQuestionTemplate({
        memo,
        prompt: `Review ${photoBasename}: confirm description and back-of-photo text are accurate.`,
        directive: directiveParts.join(" "),
      });
      const questionFilename = `${photoBasename}.review.question.card`;
      const questionPath = path.join(sessionAbsDir, questionFilename);
      await fs.writeFile(questionPath, questionContent);
      filesToStage.push(`${sessionRelDir}/${questionFilename}`);
      questionPaths.push(`${sessionRelDir}/${questionFilename}`);
    }
  }

  for (const [i, orphan] of orphanBacks.entries()) {
    const idx = String(i + 1).padStart(3, "0");
    const basename = `orphan-back-${idx}`;
    const filename = `${basename}.jpg`;
    await fs.rename(archivePages[orphan.index]!, path.join(sessionAbsDir, filename));
    filesToStage.push(`${sessionRelDir}/${filename}`);
    const ocrText = orphan.analysis.text_blocks.map((b) => b.text).join("\n").trim();
    const memo = [
      `Found a back-of-photo with no matching photo (page ${orphan.index + 1}).`,
      ocrText ? `Transcribed text:\n${ocrText}` : "(no transcribed text)",
    ].join("\n\n");
    const questionContent = createTextQuestionTemplate({
      memo,
      prompt: `Which photo does ${filename} belong with, or should it be discarded?`,
      directive: `If it belongs with a photo in this session, attach by appending text blocks to that image card. Otherwise delete ${sessionRelDir}/${filename}.`,
    });
    const questionFilename = `${basename}.question.card`;
    const questionPath = path.join(sessionAbsDir, questionFilename);
    await fs.writeFile(questionPath, questionContent);
    filesToStage.push(`${sessionRelDir}/${questionFilename}`);
    questionPaths.push(`${sessionRelDir}/${questionFilename}`);
  }

  for (const [i, page] of unsurePages.entries()) {
    const idx = String(i + 1).padStart(3, "0");
    const basename = `unsure-${idx}`;
    const filename = `${basename}.jpg`;
    await fs.rename(archivePages[page.index]!, path.join(sessionAbsDir, filename));
    filesToStage.push(`${sessionRelDir}/${filename}`);
    const memo = [
      `Could not classify page ${page.index + 1}.`,
      page.analysis.flag_reason ?? "(no specific reason given)",
    ].join("\n\n");
    const questionContent = createTextQuestionTemplate({
      memo,
      prompt: `What is ${filename}? (photo, back-of-photo, or trash)`,
      directive: `If a photo, create an image card. If a back, attach to the relevant photo card. Otherwise delete ${sessionRelDir}/${filename}.`,
    });
    const questionFilename = `${basename}.question.card`;
    const questionPath = path.join(sessionAbsDir, questionFilename);
    await fs.writeFile(questionPath, questionContent);
    filesToStage.push(`${sessionRelDir}/${questionFilename}`);
    questionPaths.push(`${sessionRelDir}/${questionFilename}`);
  }

  await fs.rm(archiveDir, { recursive: true, force: true });
  if (apiDir !== archiveDir) await fs.rm(apiDir, { recursive: true, force: true });

  const sessionCardContent = createCaptureSessionTemplate({
    sessionId,
    startedAt,
    endedAt: startedAt,
    imageRefs,
    audioRefs: [],
    fileRefs: sourceFileRef ? [sourceFileRef] : [],
  });
  const sessionCardPath = path.join(sessionAbsDir, sessionCardFilename);
  await fs.writeFile(sessionCardPath, sessionCardContent);
  filesToStage.push(`${sessionRelDir}/${sessionCardFilename}`);

  await stageFiles(ctx.boxRoot, filesToStage);
  const summaryParts: string[] = [`${bundles.length} photos`];
  if (orphanBacks.length > 0) summaryParts.push(`${orphanBacks.length} orphan backs`);
  if (unsurePages.length > 0) summaryParts.push(`${unsurePages.length} unsure`);
  await commit(ctx.boxRoot, {
    message: `Scan import: ${summaryParts.join(", ")}`,
    trailers: { "Created-By": "scan-import" },
  });

  const intakeItems = [`${sessionRelDir}/${sessionCardFilename}`, ...questionPaths];
  const intakeDescription = `Scan from ${sourceLabel}: ${bundles.length} photo${bundles.length === 1 ? "" : "s"}${questionPaths.length > 0 ? `, ${questionPaths.length} review question${questionPaths.length === 1 ? "" : "s"}` : ""}`;
  const intakeJobPath = await createOrAppendIntakeJob({
    boxRoot: ctx.boxRoot,
    source: "scan",
    items: intakeItems,
    description: intakeDescription,
  });
  ctx.writeLine(`\nIntake job: ${intakeJobPath}`);
  ctx.writeLine(`Session: ${sessionRelDir}/${sessionCardFilename}`);

  return {
    success: true,
    data: {
      mode: "photo",
      sessionRelDir,
      sessionCardPath: `${sessionRelDir}/${sessionCardFilename}`,
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

async function runDocumentMode(
  ctx: CommandContext,
  args: { pdfPath: string }
): Promise<CommandResult> {
  const layout = await createSessionLayout(ctx);
  const { sessionAbsDir, sessionRelDir, sessionCardFilename, sessionId, startedAt } = layout;
  ctx.writeLine(`Document intake → ${sessionRelDir}`);
  ctx.writeLine(`Source: ${args.pdfPath}`);

  await fs.copyFile(args.pdfPath, path.join(sessionAbsDir, "source.pdf"));
  const stat = await fs.stat(path.join(sessionAbsDir, "source.pdf"));
  const fileCard = createFileTemplate({
    capturedAt: startedAt,
    source: "scan-import",
    filename: "source.pdf",
    originalName: path.basename(args.pdfPath),
    mimeType: "application/pdf",
    size: stat.size,
  });
  await fs.writeFile(path.join(sessionAbsDir, "source.file.card"), fileCard);

  const sessionCardContent = createCaptureSessionTemplate({
    sessionId,
    startedAt,
    endedAt: startedAt,
    imageRefs: [],
    audioRefs: [],
    fileRefs: ["source.file.card"],
  });
  await fs.writeFile(path.join(sessionAbsDir, sessionCardFilename), sessionCardContent);

  const filesToStage = [
    `${sessionRelDir}/source.pdf`,
    `${sessionRelDir}/source.file.card`,
    `${sessionRelDir}/${sessionCardFilename}`,
  ];
  await stageFiles(ctx.boxRoot, filesToStage);
  await commit(ctx.boxRoot, {
    message: `Document import: ${path.basename(args.pdfPath)}`,
    trailers: { "Created-By": "scan-import" },
  });

  const intakeJobPath = await createOrAppendIntakeJob({
    boxRoot: ctx.boxRoot,
    source: "scan",
    items: [`${sessionRelDir}/${sessionCardFilename}`],
    description: `Document PDF: ${path.basename(args.pdfPath)}`,
  });
  ctx.writeLine(`\nIntake job: ${intakeJobPath}`);
  ctx.writeLine(`Session: ${sessionRelDir}/${sessionCardFilename}`);

  return {
    success: true,
    data: {
      mode: "document",
      sessionRelDir,
      sessionCardPath: `${sessionRelDir}/${sessionCardFilename}`,
      intakeJobPath,
    },
  };
}

async function applyBundleAnalysisToCard(
  loader: Awaited<ReturnType<typeof createLoader>>,
  { cardPath, bundle }: { cardPath: string; bundle: PhotoBundle }
): Promise<void> {
  const card = await loader.load(cardPath);
  const el = card.element;

  el.attrs["status"] = "analyzed";
  const photo = bundle.photo;
  const back = bundle.back;

  const photoTextBlocks = photo.text_blocks.map((b) => ({
    source: b.source || "photo",
    text: b.text,
  }));
  const backTextBlocks = back
    ? back.text_blocks.map((b) => ({ source: b.source || "back", text: b.text }))
    : [];
  const allTextBlocks = [...photoTextBlocks, ...backTextBlocks];
  const hasText = allTextBlocks.length > 0;

  el.attrs["has-text"] = hasText ? "true" : "false";
  if (photo.rotation !== 0) {
    el.attrs["rotation"] = String(photo.rotation);
  }

  const descChild = el.children.find((c) => c.tagName === "description");
  if (descChild) descChild.text = photo.description;

  el.children = el.children.filter(
    (c) =>
      c.tagName !== "text" &&
      c.tagName !== "exif" &&
      c.tagName !== "subject-bbox" &&
      c.tagName !== "document"
  );

  for (const block of allTextBlocks) {
    el.children.push({
      tagName: "text",
      attrs: { source: block.source },
      text: block.text,
      children: [],
      comments: {},
      location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
      dirty: true,
    });
  }

  if (photo.subject_bbox && photo.subject_bbox.length === 4) {
    el.children.push({
      tagName: "subject-bbox",
      attrs: {
        y1: String(photo.subject_bbox[0]),
        x1: String(photo.subject_bbox[1]),
        y2: String(photo.subject_bbox[2]),
        x2: String(photo.subject_bbox[3]),
      },
      text: "",
      children: [],
      comments: {},
      location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
      dirty: true,
    });
  }

  await loader.save(card);
}

registerCommand({
  name: "scan-import",
  description: "Import a scanned PDF, image batch, or document PDF as a session in box/inbox/scan-…/",
  args: [
    {
      name: "inputs",
      description: "PDF (one) or image files (many) — absolute or relative to box root",
      required: true,
      type: "string[]",
    },
    {
      name: "archiveDpi",
      description: "DPI for archival JPEG render of each PDF page (PDF inputs only)",
      required: false,
      default: 600,
      type: "number",
    },
    {
      name: "apiScaleTo",
      description: "Longest-side pixel size for the API copy sent to Gemini (PDF inputs only)",
      required: false,
      default: 2000,
      type: "number",
    },
    {
      name: "context",
      description: "Extra context appended to CLAUDE_SCANS.md content for this run",
      required: false,
      type: "string",
    },
    {
      name: "treatAs",
      description: "Force PDF mode: 'scan' (run Flash) or 'document' (file as PDF, no Flash)",
      required: false,
      type: "string",
    },
  ],
  execute: executeScanImport,
});

export { executeScanImport };
