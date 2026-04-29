/**
 * Scan-Import command — turn a scanned PDF of photographs into image cards.
 *
 * Each PDF page is rendered to a JPEG; pages are sent to Gemini Flash in
 * sliding-overlap batches to classify each page as photo / back-of-photo /
 * blank / unsure and to pair photos with their backs. Results become a
 * capture-session card with one image card per photo, sibling back-of-photo
 * JPEGs preserved when uncertain, and question cards for orphans.
 *
 * Mirrors the capture-session layout from src/webapp/routes/capture.ts so
 * later transcripts (handwriting walkthroughs, voice notes about the stack)
 * can attach to the same session.
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
  renderPdfPages,
  runScanBatches,
  resolveScanPages,
  bundleResolvedPages,
  type PhotoBundle,
} from "./scan-import-helpers.js";

export interface ScanImportArgs {
  pdfPath: string;
  archiveDpi?: number;
  apiScaleTo?: number;
  /** Extra free-form context appended to CLAUDE_SCANS.md content for this run. */
  context?: string;
}

/**
 * Read the persistent scan context (recurring people, eras, places) from
 * CLAUDE_SCANS.md at the box root, if it exists. Returns null when absent
 * so the prompt skips the context section entirely.
 */
async function readScanContextFile(boxRoot: string): Promise<string | null> {
  const candidates = ["CLAUDE_SCANS.md", "claude_scans.md"];
  for (const name of candidates) {
    try {
      const content = await fs.readFile(path.join(boxRoot, name), "utf-8");
      if (content.trim().length > 0) return content;
    } catch {
      // File doesn't exist — try next candidate.
    }
  }
  return null;
}

async function executeScanImport(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const { pdfPath: rawPdfPath, archiveDpi = 600, apiScaleTo = 2000, context: extraContext } =
    args as unknown as ScanImportArgs;

  if (!rawPdfPath) {
    return { success: false, error: "pdfPath argument is required" };
  }

  const apiKey = process.env["GEMINI_KEY"] || process.env["SKE_GEMINI_API_KEY"];
  if (!apiKey) {
    return { success: false, error: "GEMINI_KEY environment variable is required" };
  }

  const pdfAbsPath = path.isAbsolute(rawPdfPath) ? rawPdfPath : path.join(ctx.boxRoot, rawPdfPath);
  try {
    await fs.access(pdfAbsPath);
  } catch {
    return { success: false, error: `PDF not found: ${pdfAbsPath}` };
  }

  const sessionId = randomUUID();
  const shortId = sessionId.slice(0, 8);
  const startedAt = getBoxTimeISO(ctx.boxRoot);
  // Format: scan-YYYYMMDDTHHMM-shortId
  const stamp = startedAt.replace(/[:-]/g, "").slice(0, 13);
  const formattedDate = `${stamp.slice(0, 8)}T${stamp.slice(9, 13)}`;
  const sessionDirName = `scan-${formattedDate}-${shortId}`;
  const sessionRelDir = `box/inbox/${sessionDirName}`;
  const sessionAbsDir = path.join(ctx.boxRoot, sessionRelDir);
  await fs.mkdir(sessionAbsDir, { recursive: true });

  ctx.writeLine(`Scan import → ${sessionRelDir}`);
  ctx.writeLine(`Source: ${pdfAbsPath}`);

  // Copy the PDF into the session dir as the source-of-truth archive,
  // along with a file card pointing at it.
  const sourcePdfName = "source.pdf";
  const sourceFileCardName = "source.file.card";
  await fs.copyFile(pdfAbsPath, path.join(sessionAbsDir, sourcePdfName));
  const pdfStat = await fs.stat(path.join(sessionAbsDir, sourcePdfName));
  const sourceFileCardContent = createFileTemplate({
    capturedAt: startedAt,
    source: "scan-import",
    filename: sourcePdfName,
    originalName: path.basename(pdfAbsPath),
    mimeType: "application/pdf",
    size: pdfStat.size,
  });
  await fs.writeFile(path.join(sessionAbsDir, sourceFileCardName), sourceFileCardContent);

  // Render archive (high-res) and API (downsampled) copies to scratch dirs
  // inside the session. Archive copies become photo-NNN.jpg via rename;
  // API copies are deleted after analysis.
  const archiveDir = path.join(sessionAbsDir, ".scan-archive");
  const apiDir = path.join(sessionAbsDir, ".scan-api");

  ctx.writeLine(`Rendering archive copies at ${archiveDpi}dpi...`);
  const archivePages = await renderPdfPages({
    pdfPath: pdfAbsPath,
    outDir: archiveDir,
    prefix: "page",
    mode: { dpi: archiveDpi },
  });
  ctx.writeLine(`  ${archivePages.length} pages rendered`);

  ctx.writeLine(`Rendering API copies at scale-to=${apiScaleTo}...`);
  const apiPages = await renderPdfPages({
    pdfPath: pdfAbsPath,
    outDir: apiDir,
    prefix: "page",
    mode: { scaleTo: apiScaleTo },
    jpegQuality: 85,
  });
  ctx.writeLine(`  ${apiPages.length} pages rendered`);

  if (archivePages.length !== apiPages.length) {
    return {
      success: false,
      error: `Page count mismatch between archive (${archivePages.length}) and API (${apiPages.length}) renders`,
    };
  }

  // Build the boxholder-context block: persistent file content first, then
  // any per-run --context addition.
  const fileContext = await readScanContextFile(ctx.boxRoot);
  const contextParts: string[] = [];
  if (fileContext) contextParts.push(fileContext.trim());
  if (extraContext && extraContext.trim().length > 0) contextParts.push(extraContext.trim());
  const boxholderContext = contextParts.length > 0 ? contextParts.join("\n\n---\n\n") : null;

  if (boxholderContext) {
    ctx.writeLine(`Using boxholder context (${boxholderContext.length} chars${fileContext ? " from CLAUDE_SCANS.md" : ""}${extraContext ? " + --context" : ""})`);
  }

  ctx.writeLine(`Analyzing ${apiPages.length} pages with Gemini Flash...`);
  const batchResult = await runScanBatches({
    apiKey,
    imagePaths: apiPages,
    boxholderContext,
    log: (line) => ctx.writeLine(line),
  });

  if (batchResult.failed > 0) {
    ctx.writeLine(`${batchResult.failed} page(s) failed analysis`);
  }
  if (batchResult.usage) {
    ctx.writeLine(
      `Tokens: input=${batchResult.usage.prompt}, output=${batchResult.usage.output}, thinking=${batchResult.usage.thinking}`
    );
  }

  const resolved = resolveScanPages(batchResult.pageAnalyses, apiPages.length);
  const { bundles, orphanBacks, unsurePages, blankPages } = bundleResolvedPages(resolved);

  ctx.writeLine(
    `\nResults: ${bundles.length} photos (${bundles.filter((b) => b.backIndex !== null).length} with backs), ${orphanBacks.length} orphan backs, ${unsurePages.length} unsure, ${blankPages.length} blank`
  );

  // Assemble cards
  const loader = await createLoader(ctx.boxRoot);
  const filesToStage: string[] = [];
  const imageRefs: string[] = [];
  const questionPaths: string[] = [];

  for (const [i, bundle] of bundles.entries()) {
    const photoIdx = String(i + 1).padStart(3, "0");
    const photoBasename = `photo-${photoIdx}`;
    const photoFilename = `${photoBasename}.jpg`;
    const cardFilename = `${photoBasename}.image.card`;

    // Move the archive page into place under the photo basename.
    await fs.rename(archivePages[bundle.photoIndex]!, path.join(sessionAbsDir, photoFilename));
    filesToStage.push(`${sessionRelDir}/${photoFilename}`);

    // Always keep the paired back as a sibling — OCR of handwriting is
    // fallible and the user needs the original to verify or correct.
    let backFilename: string | null = null;
    if (bundle.backIndex !== null) {
      backFilename = `${photoBasename}-back.jpg`;
      await fs.rename(archivePages[bundle.backIndex]!, path.join(sessionAbsDir, backFilename));
      filesToStage.push(`${sessionRelDir}/${backFilename}`);
    }

    // Create the image card from the standard template, then apply analysis.
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
        `Photo ${photoIdx} (PDF page ${bundle.photoIndex + 1}${bundle.backIndex !== null ? `, back on page ${bundle.backIndex + 1}` : ""}) needs review:`,
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

  // Orphan backs become standalone question cards with the back image attached.
  for (const [i, orphan] of orphanBacks.entries()) {
    const backIdx = String(i + 1).padStart(3, "0");
    const backBasename = `orphan-back-${backIdx}`;
    const backFilename = `${backBasename}.jpg`;
    await fs.rename(archivePages[orphan.index]!, path.join(sessionAbsDir, backFilename));
    filesToStage.push(`${sessionRelDir}/${backFilename}`);

    const ocrText = orphan.analysis.text_blocks.map((b) => b.text).join("\n").trim();
    const memo = [
      `Found a back-of-photo with no matching photo (PDF page ${orphan.index + 1}).`,
      ocrText ? `Transcribed text:\n${ocrText}` : "(no transcribed text)",
    ].join("\n\n");
    const questionContent = createTextQuestionTemplate({
      memo,
      prompt: `Which photo does ${backFilename} belong with, or should it be discarded?`,
      directive: `If it belongs with a photo in this session, attach by appending text blocks to that image card. Otherwise delete ${sessionRelDir}/${backFilename}.`,
    });
    const questionFilename = `${backBasename}.question.card`;
    const questionPath = path.join(sessionAbsDir, questionFilename);
    await fs.writeFile(questionPath, questionContent);
    filesToStage.push(`${sessionRelDir}/${questionFilename}`);
    questionPaths.push(`${sessionRelDir}/${questionFilename}`);
  }

  // Unsure pages: save the page and ask.
  for (const [i, page] of unsurePages.entries()) {
    const idx = String(i + 1).padStart(3, "0");
    const basename = `unsure-${idx}`;
    const filename = `${basename}.jpg`;
    await fs.rename(archivePages[page.index]!, path.join(sessionAbsDir, filename));
    filesToStage.push(`${sessionRelDir}/${filename}`);
    const memo = [
      `Could not classify PDF page ${page.index + 1}.`,
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

  // Discard archive pages we didn't keep.
  await fs.rm(archiveDir, { recursive: true, force: true });
  await fs.rm(apiDir, { recursive: true, force: true });

  // Capture-session card. Status starts at "intake-complete" since image
  // analysis is already done — the reactor's intake guide takes over from
  // here. (The "transcribing"/"transcribed" states are audio-pipeline
  // specific; for a scan they're skipped.)
  const sessionCardFilename = `${sessionDirName}.capture-session.card`;
  const sessionCardContent = createCaptureSessionTemplate({
    sessionId,
    startedAt,
    endedAt: startedAt,
    imageRefs,
    audioRefs: [],
    fileRefs: [sourceFileCardName],
  });
  const sessionCardPath = path.join(sessionAbsDir, sessionCardFilename);
  await fs.writeFile(sessionCardPath, sessionCardContent);
  filesToStage.push(`${sessionRelDir}/${sessionCardFilename}`);
  filesToStage.push(`${sessionRelDir}/${sourcePdfName}`);
  filesToStage.push(`${sessionRelDir}/${sourceFileCardName}`);

  // Stage and commit everything in one go (matches capture finalize).
  if (filesToStage.length > 0) {
    await stageFiles(ctx.boxRoot, filesToStage);
    const summaryParts: string[] = [];
    summaryParts.push(`${bundles.length} photos`);
    if (orphanBacks.length > 0) summaryParts.push(`${orphanBacks.length} orphan backs`);
    if (unsurePages.length > 0) summaryParts.push(`${unsurePages.length} unsure`);
    await commit(ctx.boxRoot, {
      message: `Scan import: ${summaryParts.join(", ")}`,
      trailers: { "Created-By": "scan-import" },
    });
  }

  // File an intake job referencing the session card and any open questions.
  const intakeItems = [`${sessionRelDir}/${sessionCardFilename}`, ...questionPaths];
  const intakeDescription = `Scan from ${path.basename(pdfAbsPath)}: ${bundles.length} photo${bundles.length === 1 ? "" : "s"}${questionPaths.length > 0 ? `, ${questionPaths.length} review question${questionPaths.length === 1 ? "" : "s"}` : ""}`;
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

/**
 * Apply a scan-mode photo bundle to a freshly-created image card. We adapt
 * the bundle into the ImageAnalysis shape so we can reuse the loader-based
 * mutation pattern from describe-images.ts (rather than serializing XML by
 * hand).
 */
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
  if (descChild) {
    descChild.text = photo.description;
  }

  // Replace text/exif/subject-bbox/document children — fresh card has none,
  // but the filter is cheap and keeps this consistent with describe-images.
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
  description: "Import a scanned PDF of photographs as image cards (Gemini Flash pairs photos with their backs)",
  args: [
    {
      name: "pdfPath",
      description: "Path to the PDF file (absolute or relative to box root)",
      required: true,
      type: "string",
    },
    {
      name: "archiveDpi",
      description: "DPI for archival JPEG render of each page",
      required: false,
      default: 600,
      type: "number",
    },
    {
      name: "apiScaleTo",
      description: "Longest-side pixel size for the API copy sent to Gemini",
      required: false,
      default: 2000,
      type: "number",
    },
    {
      name: "context",
      description: "Extra context appended to CLAUDE_SCANS.md content for this run (e.g. \"1985 family reunion in Maine\")",
      required: false,
      type: "string",
    },
  ],
  execute: executeScanImport,
});

export { executeScanImport };
