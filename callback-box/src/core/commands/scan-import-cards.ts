/**
 * Card emission for the scan-import photo flow.
 *
 * Three cohesive jobs live here:
 *   - `emitPhotoBundle` — write a photo's image card (renaming the photo and
 *     any back JPEG into the card's attach scope), apply the Gemini analysis,
 *     and emit a review question when the bundle is flagged.
 *   - `emitOrphanBackQuestion` / `emitUnsureQuestion` — file a loose JPEG and
 *     a text question prompting the human to place or discard it.
 *   - `applyBundleAnalysisToCard` — mutate a freshly-written image card with
 *     the analyzed description, text blocks, rotation, and subject bbox.
 *
 * Photo/JPEG artifacts stay in the session's attach scope, but question cards
 * land in `box/questions/` (the one location `getSystemState` scans for
 * questions — see `docs/box-layout.md`), named with a session-slug prefix to
 * avoid collisions across sessions, with a `context:` ref back into the
 * attach scope.
 *
 * Each emitter pushes onto the caller's `filesToStage`/`questionPaths` arrays
 * and (for bundles) the `imageRefs` array, mirroring the original inline loops
 * exactly.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseCardText, serializeCardText } from "../card-io.js";
import { invariant } from "../../lib/invariant.js";
import { type CardSchema } from "../../cards/index.js";
import { getBoxDir } from "../../lib/paths.js";
import { createImageTemplate } from "../../schemas/image.js";
import { createTextQuestionTemplate } from "../../schemas/question.js";
import { SCAN_GUIDE_REL_PATH } from "./scan-guide-context.js";
import type { PhotoBundle, OrphanBack, ResolvedPage } from "./scan-import-helpers.js";

/** Ensure `box/questions/` exists and return its absolute path. */
async function questionsDir(boxRoot: string): Promise<string> {
  const dir = getBoxDir(boxRoot, "questions");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * A short, filename-safe slug identifying the capture session, so multiple
 * scan-import runs don't collide when their question cards land together in
 * `box/questions/` (unlike the old per-session attach scope, which never
 * collided across sessions by construction).
 */
function sessionSlug(sessionAttachRelDir: string): string {
  return path.basename(sessionAttachRelDir).replace(/\.attach$/, "");
}

interface PhotoBundleEmitContext {
  cardSchemas: Map<string, CardSchema>;
  index: number;
  bundle: PhotoBundle;
  startedAt: string;
  boxRoot: string;
  sessionAttachAbsDir: string;
  sessionAttachRelDir: string;
  archivePages: string[];
  filesToStage: string[];
  imageRefs: string[];
  questionPaths: string[];
}

/**
 * Look up a page's archived scratch-copy path. `index` is a page index
 * produced by `resolveScanPages`/`bundleResolvedPages` from the same
 * `archivePages` array (one archived copy per input page), so it's always
 * in range.
 */
function archivedPagePath(archivePages: string[], index: number): string {
  const p = archivePages[index];
  invariant(p !== undefined, "page index is within the archivePages range it was derived from");
  return p;
}

export async function emitPhotoBundle(emitCtx: PhotoBundleEmitContext): Promise<void> {
  const {
    cardSchemas,
    index,
    bundle,
    startedAt,
    boxRoot,
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
  await fs.rename(archivedPagePath(archivePages, bundle.photoIndex), path.join(photoAttachAbs, photoFilename));
  filesToStage.push(`${sessionAttachRelDir}/${photoBasename}.attach/${photoFilename}`);

  let backFilename: string | null = null;
  if (bundle.backIndex !== null) {
    backFilename = `${photoBasename}-back.jpg`;
    await fs.rename(archivedPagePath(archivePages, bundle.backIndex), path.join(photoAttachAbs, backFilename));
    filesToStage.push(`${sessionAttachRelDir}/${photoBasename}.attach/${backFilename}`);
  }

  const cardContent = createImageTemplate({
    capturedAt: startedAt,
    source: "gallery",
    filename: photoFilename,
  });
  const cardPath = path.join(sessionAttachAbsDir, cardFilename);
  await fs.writeFile(cardPath, cardContent);
  await applyBundleAnalysisToCard({ cardPath, bundle, cardSchemas });
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
      askedAt: startedAt,
      context: [{ ref: `${sessionAttachRelDir}/${cardFilename}` }],
      // Identification ambiguities are where durable scanner priors surface;
      // one-off dispositions (orphan-back/unsure questions) deliberately
      // carry no learning: — see docs/plans/scan-guide-card.md.
      learning: {
        sink: "guide",
        ref: SCAN_GUIDE_REL_PATH,
        proposal:
          "If the answer settles a DURABLE identification or pattern (a recurring person, place, vendor, or handwriting convention — not a one-off fix to this photo), record it as a triage-rule belief in the scan guide, creating the guide first via `cb create guide --name scan` if it does not exist. Skip recording for one-off corrections.",
      },
    });
    const questionFilename = `${sessionSlug(sessionAttachRelDir)}-${photoBasename}.review.question.card`;
    const questionPath = path.join(await questionsDir(boxRoot), questionFilename);
    await fs.writeFile(questionPath, questionContent);
    const questionRelPath = path.relative(boxRoot, questionPath);
    filesToStage.push(questionRelPath);
    questionPaths.push(questionRelPath);
  }
}

interface LooseQuestionContext {
  index: number;
  boxRoot: string;
  sessionAttachAbsDir: string;
  sessionAttachRelDir: string;
  archivePages: string[];
  filesToStage: string[];
  questionPaths: string[];
  askedAt: string;
}

export async function emitOrphanBackQuestion(
  orphan: OrphanBack,
  looseCtx: LooseQuestionContext
): Promise<void> {
  const { index, boxRoot, sessionAttachAbsDir, sessionAttachRelDir, archivePages, filesToStage, questionPaths, askedAt } = looseCtx;
  const idx = String(index + 1).padStart(3, "0");
  const basename = `orphan-back-${idx}`;
  const filename = `${basename}.jpg`;
  // Loose image (no card) — lives directly in the session's attach scope.
  await fs.rename(archivedPagePath(archivePages, orphan.index), path.join(sessionAttachAbsDir, filename));
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
    askedAt,
    context: [{ ref: `${sessionAttachRelDir}/${filename}` }],
  });
  const questionFilename = `${sessionSlug(sessionAttachRelDir)}-${basename}.question.card`;
  const questionPath = path.join(await questionsDir(boxRoot), questionFilename);
  await fs.writeFile(questionPath, questionContent);
  const questionRelPath = path.relative(boxRoot, questionPath);
  filesToStage.push(questionRelPath);
  questionPaths.push(questionRelPath);
}

export async function emitUnsureQuestion(
  page: ResolvedPage,
  looseCtx: LooseQuestionContext
): Promise<void> {
  const { index, boxRoot, sessionAttachAbsDir, sessionAttachRelDir, archivePages, filesToStage, questionPaths, askedAt } = looseCtx;
  const idx = String(index + 1).padStart(3, "0");
  const basename = `unsure-${idx}`;
  const filename = `${basename}.jpg`;
  await fs.rename(archivedPagePath(archivePages, page.index), path.join(sessionAttachAbsDir, filename));
  filesToStage.push(`${sessionAttachRelDir}/${filename}`);
  const memo = [
    `Could not classify page ${page.index + 1}.`,
    page.analysis.flag_reason ?? "(no specific reason given)",
  ].join("\n\n");
  const questionContent = createTextQuestionTemplate({
    memo,
    prompt: `What is ${filename}? (photo, back-of-photo, or trash)`,
    directive: `If a photo, create an image card. If a back, attach to the relevant photo card. Otherwise delete ${sessionAttachRelDir}/${filename}.`,
    askedAt,
    context: [{ ref: `${sessionAttachRelDir}/${filename}` }],
  });
  const questionFilename = `${sessionSlug(sessionAttachRelDir)}-${basename}.question.card`;
  const questionPath = path.join(await questionsDir(boxRoot), questionFilename);
  await fs.writeFile(questionPath, questionContent);
  const questionRelPath = path.relative(boxRoot, questionPath);
  filesToStage.push(questionRelPath);
  questionPaths.push(questionRelPath);
}

async function applyBundleAnalysisToCard(
  { cardPath, bundle, cardSchemas }: { cardPath: string; bundle: PhotoBundle; cardSchemas: Map<string, CardSchema> }
): Promise<void> {
  const content = await fs.readFile(cardPath, "utf-8");
  const parsed = parseCardText(content, { source: cardPath, schemas: cardSchemas, type: "image" });
  const fields = { ...parsed.fields };

  const photo = bundle.photo;
  const back = bundle.back;

  // The image schema's `text` field is an array of { source, content }.
  const photoTextBlocks = photo.text_blocks.map((b) => ({ source: b.source || "photo", content: b.text }));
  const backTextBlocks = back
    ? back.text_blocks.map((b) => ({ source: b.source || "back", content: b.text }))
    : [];
  const allTextBlocks = [...photoTextBlocks, ...backTextBlocks];

  fields["status"] = "analyzed";
  fields["has-text"] = allTextBlocks.length > 0;
  fields["description"] = photo.description;
  if (photo.rotation !== 0) fields["rotation"] = String(photo.rotation);

  if (allTextBlocks.length > 0) fields["text"] = allTextBlocks;
  else delete fields["text"];

  if (photo.subject_bbox && photo.subject_bbox.length === 4) {
    fields["subject-bbox"] = {
      y1: String(photo.subject_bbox[0]),
      x1: String(photo.subject_bbox[1]),
      y2: String(photo.subject_bbox[2]),
      x2: String(photo.subject_bbox[3]),
    };
  }

  await fs.writeFile(cardPath, serializeCardText({ schema: parsed.schema, fields }));
}
