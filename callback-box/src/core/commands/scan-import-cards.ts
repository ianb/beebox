/**
 * Card emission for the scan-import photo flow.
 *
 * Three cohesive jobs live here, all operating on the session's attach scope:
 *   - `emitPhotoBundle` — write a photo's image card (renaming the photo and
 *     any back JPEG into the card's attach scope), apply the Gemini analysis,
 *     and emit a review question when the bundle is flagged.
 *   - `emitOrphanBackQuestion` / `emitUnsureQuestion` — file a loose JPEG and
 *     a text question prompting the human to place or discard it.
 *   - `applyBundleAnalysisToCard` — mutate a freshly-written image card with
 *     the analyzed description, text blocks, rotation, and subject bbox.
 *
 * Each emitter pushes onto the caller's `filesToStage`/`questionPaths` arrays
 * and (for bundles) the `imageRefs` array, mirroring the original inline loops
 * exactly.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { createLoader } from "../../cli/lib/loader.js";
import { createImageTemplate } from "../../schemas/image.js";
import { createTextQuestionTemplate } from "../../schemas/question.js";
import type { PhotoBundle, OrphanBack, ResolvedPage } from "./scan-import-helpers.js";

type Loader = Awaited<ReturnType<typeof createLoader>>;

interface PhotoBundleEmitContext {
  loader: Loader;
  index: number;
  bundle: PhotoBundle;
  startedAt: string;
  sessionAttachAbsDir: string;
  sessionAttachRelDir: string;
  archivePages: string[];
  filesToStage: string[];
  imageRefs: string[];
  questionPaths: string[];
}

export async function emitPhotoBundle(emitCtx: PhotoBundleEmitContext): Promise<void> {
  const {
    loader,
    index,
    bundle,
    startedAt,
    sessionAttachAbsDir,
    sessionAttachRelDir,
    archivePages,
    filesToStage,
    imageRefs,
    questionPaths,
  } = emitCtx;
  const photoIdx = String(index + 1).padStart(3, "0");
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

interface LooseQuestionContext {
  index: number;
  sessionAttachAbsDir: string;
  sessionAttachRelDir: string;
  archivePages: string[];
  filesToStage: string[];
  questionPaths: string[];
}

export async function emitOrphanBackQuestion(
  orphan: OrphanBack,
  looseCtx: LooseQuestionContext
): Promise<void> {
  const { index, sessionAttachAbsDir, sessionAttachRelDir, archivePages, filesToStage, questionPaths } = looseCtx;
  const idx = String(index + 1).padStart(3, "0");
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

export async function emitUnsureQuestion(
  page: ResolvedPage,
  looseCtx: LooseQuestionContext
): Promise<void> {
  const { index, sessionAttachAbsDir, sessionAttachRelDir, archivePages, filesToStage, questionPaths } = looseCtx;
  const idx = String(index + 1).padStart(3, "0");
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

async function applyBundleAnalysisToCard(
  loader: Loader,
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
