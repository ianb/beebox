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
  runScanBatches,
  resolveScanPages,
  bundleResolvedPages,
  type PhotoBundle,
} from "./scan-import-helpers.js";

export interface ScanImportArgs {
  inputs: string[];
  context?: string;
}

interface SessionLayout {
  sessionId: string;
  /** Basename of the session card (e.g. `scan-20260310T1924-abc12345`). */
  sessionBasename: string;
  /** Inbox-relative dir holding the session card. */
  inboxRelDir: string;
  /** Absolute path to the directory that holds the session card. */
  inboxAbsDir: string;
  /** Filename of the session card itself. */
  sessionCardFilename: string;
  /** Absolute path to the session card. */
  sessionCardAbsPath: string;
  /** Inbox-relative path to the session card. */
  sessionCardRelPath: string;
  /** Inbox-relative dir of the session's attach scope. */
  sessionAttachRelDir: string;
  /** Absolute path to the session's attach scope. */
  sessionAttachAbsDir: string;
  startedAt: string;
}

const isImageFile = (p: string): boolean =>
  SUPPORTED_IMAGE_EXTENSIONS.includes(path.extname(p).toLowerCase());
const isPdfFile = (p: string): boolean =>
  path.extname(p).toLowerCase() === PDF_EXTENSION;

async function readScanContextFile(boxRoot: string): Promise<string | null> {
  for (const name of ["CLAUDE_SCANS.md", "claude_scans.md"]) {
    try {
      const content = await fs.readFile(path.join(boxRoot, name), "utf-8");
      if (content.trim().length > 0) return content;
    } catch (_e) {
      // Context file is optional — readFile rejects when this candidate
      // name doesn't exist, which is the common case. Try the next name;
      // returning null (no context) at the end is a valid outcome.
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
  const sessionBasename = `scan-${formattedDate}-${shortId}`;
  const inboxRelDir = "box/inbox";
  const inboxAbsDir = path.join(ctx.boxRoot, inboxRelDir);
  const sessionCardFilename = `${sessionBasename}.capture-session.card`;
  const sessionAttachRelDir = `${inboxRelDir}/${sessionBasename}.attach`;
  const sessionAttachAbsDir = path.join(ctx.boxRoot, sessionAttachRelDir);
  await fs.mkdir(sessionAttachAbsDir, { recursive: true });
  return {
    sessionId,
    sessionBasename,
    inboxRelDir,
    inboxAbsDir,
    sessionCardFilename,
    sessionCardAbsPath: path.join(inboxAbsDir, sessionCardFilename),
    sessionCardRelPath: `${inboxRelDir}/${sessionCardFilename}`,
    sessionAttachRelDir,
    sessionAttachAbsDir,
    startedAt,
  };
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

    // Photo and its back live in the image card's attach scope.
    const photoAttachAbs = path.join(sessionAttachAbsDir, `${photoBasename}.attach`);
    await fs.mkdir(photoAttachAbs, { recursive: true });
    await fs.rename(archivePages[bundle.photoIndex]!, path.join(photoAttachAbs, photoFilename));
    filesToStage.push(`${sessionAttachRelDir}/${photoBasename}.attach/${photoFilename}`);

    let backFilename: string | null = null;
    if (bundle.backIndex !== null) {
      backFilename = `${photoBasename}-back.jpg`;
      await fs.rename(archivePages[bundle.backIndex]!, path.join(photoAttachAbs, backFilename));
      filesToStage.push(`${sessionAttachRelDir}/${photoBasename}.attach/${backFilename}`);
    }

    const cardContent = createImageTemplate({
      capturedAt: startedAt,
      source: "gallery",
      filename: photoFilename,
    });
    const cardPath = path.join(sessionAttachAbsDir, cardFilename);
    await fs.writeFile(cardPath, cardContent);
    await applyBundleAnalysisToCard(loader, { cardPath, bundle });
    filesToStage.push(`${sessionAttachRelDir}/${cardFilename}`);
    imageRefs.push(cardFilename);

    if (bundle.flagForReview) {
      const memo = [
        `Photo ${photoIdx} (page ${bundle.photoIndex + 1}${bundle.backIndex !== null ? `, back on page ${bundle.backIndex + 1}` : ""}) needs review:`,
        ...bundle.flagReasons.map((r) => `- ${r}`),
      ].join("\n");
      const directiveParts = [`Open ${sessionAttachRelDir}/${cardFilename} and adjust description or text blocks.`];
      if (backFilename) {
        directiveParts.push(`Cross-check the back transcription against ${sessionAttachRelDir}/${photoBasename}.attach/${backFilename}.`);
      }
      const questionContent = createTextQuestionTemplate({
        memo,
        prompt: `Review ${photoBasename}: confirm description and back-of-photo text are accurate.`,
        directive: directiveParts.join(" "),
      });
      const questionFilename = `${photoBasename}.review.question.card`;
      const questionPath = path.join(sessionAttachAbsDir, questionFilename);
      await fs.writeFile(questionPath, questionContent);
      filesToStage.push(`${sessionAttachRelDir}/${questionFilename}`);
      questionPaths.push(`${sessionAttachRelDir}/${questionFilename}`);
    }
  }

  for (const [i, orphan] of orphanBacks.entries()) {
    const idx = String(i + 1).padStart(3, "0");
    const basename = `orphan-back-${idx}`;
    const filename = `${basename}.jpg`;
    // Loose image (no card) — lives directly in the session's attach scope.
    await fs.rename(archivePages[orphan.index]!, path.join(sessionAttachAbsDir, filename));
    filesToStage.push(`${sessionAttachRelDir}/${filename}`);
    const ocrText = orphan.analysis.text_blocks.map((b) => b.text).join("\n").trim();
    const memo = [
      `Found a back-of-photo with no matching photo (page ${orphan.index + 1}).`,
      ocrText ? `Transcribed text:\n${ocrText}` : "(no transcribed text)",
    ].join("\n\n");
    const questionContent = createTextQuestionTemplate({
      memo,
      prompt: `Which photo does ${filename} belong with, or should it be discarded?`,
      directive: `If it belongs with a photo in this session, attach by appending text blocks to that image card. Otherwise delete ${sessionAttachRelDir}/${filename}.`,
    });
    const questionFilename = `${basename}.question.card`;
    const questionPath = path.join(sessionAttachAbsDir, questionFilename);
    await fs.writeFile(questionPath, questionContent);
    filesToStage.push(`${sessionAttachRelDir}/${questionFilename}`);
    questionPaths.push(`${sessionAttachRelDir}/${questionFilename}`);
  }

  for (const [i, page] of unsurePages.entries()) {
    const idx = String(i + 1).padStart(3, "0");
    const basename = `unsure-${idx}`;
    const filename = `${basename}.jpg`;
    await fs.rename(archivePages[page.index]!, path.join(sessionAttachAbsDir, filename));
    filesToStage.push(`${sessionAttachRelDir}/${filename}`);
    const memo = [
      `Could not classify page ${page.index + 1}.`,
      page.analysis.flag_reason ?? "(no specific reason given)",
    ].join("\n\n");
    const questionContent = createTextQuestionTemplate({
      memo,
      prompt: `What is ${filename}? (photo, back-of-photo, or trash)`,
      directive: `If a photo, create an image card. If a back, attach to the relevant photo card. Otherwise delete ${sessionAttachRelDir}/${filename}.`,
    });
    const questionFilename = `${basename}.question.card`;
    const questionPath = path.join(sessionAttachAbsDir, questionFilename);
    await fs.writeFile(questionPath, questionContent);
    filesToStage.push(`${sessionAttachRelDir}/${questionFilename}`);
    questionPaths.push(`${sessionAttachRelDir}/${questionFilename}`);
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

async function runDocumentMode(
  ctx: CommandContext,
  args: { pdfPath: string }
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
  ctx.writeLine(`Document intake → ${sessionCardRelPath}`);
  ctx.writeLine(`Source: ${args.pdfPath}`);

  // The PDF lives in the file-card's own attach scope.
  const fileCardBasename = "source";
  const fileCardFilename = `${fileCardBasename}.file.card`;
  const fileAttachAbsDir = path.join(sessionAttachAbsDir, `${fileCardBasename}.attach`);
  await fs.mkdir(fileAttachAbsDir, { recursive: true });
  const pdfDestPath = path.join(fileAttachAbsDir, "source.pdf");
  await fs.copyFile(args.pdfPath, pdfDestPath);
  const stat = await fs.stat(pdfDestPath);
  const fileCard = createFileTemplate({
    capturedAt: startedAt,
    source: "scan-import",
    filename: "source.pdf",
    originalName: path.basename(args.pdfPath),
    mimeType: "application/pdf",
    size: stat.size,
  });
  await fs.writeFile(path.join(sessionAttachAbsDir, fileCardFilename), fileCard);

  const sessionCardContent = createCaptureSessionTemplate({
    sessionId,
    startedAt,
    endedAt: startedAt,
    imageRefs: [],
    audioRefs: [],
    fileRefs: [fileCardFilename],
  });
  await fs.writeFile(sessionCardAbsPath, sessionCardContent);

  const filesToStage = [
    `${sessionAttachRelDir}/${fileCardBasename}.attach/source.pdf`,
    `${sessionAttachRelDir}/${fileCardFilename}`,
    sessionCardRelPath,
  ];
  await stageFiles(ctx.boxRoot, filesToStage);
  await commit(ctx.boxRoot, {
    message: `Document import: ${path.basename(args.pdfPath)}`,
    trailers: { "Created-By": "scan-import" },
  });

  const intakeJobPath = await createOrAppendIntakeJob({
    boxRoot: ctx.boxRoot,
    source: "scan",
    items: [sessionCardRelPath],
    description: `Document PDF: ${path.basename(args.pdfPath)}`,
  });
  ctx.writeLine(`\nIntake job: ${intakeJobPath}`);
  ctx.writeLine(`Session: ${sessionCardRelPath}`);

  return {
    success: true,
    data: {
      mode: "document",
      sessionRelDir: sessionAttachRelDir,
      sessionCardPath: sessionCardRelPath,
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
