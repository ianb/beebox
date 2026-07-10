/**
 * Describe Images command — Analyze images using Gemini Flash.
 *
 * Processes image cards (or raw image files) through Gemini 2.5 Flash to get:
 * - Description/summary
 * - OCR text extraction
 * - Suggested title for renaming
 * - Document bounding box for cropping
 * - EXIF metadata (date, camera, GPS, dimensions)
 *
 * All images are sent in a single batch request so the model sees them
 * together, which gives better context (e.g., a stack of related bills).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { renderFrontmatterBlock } from "../../cards/index.js";
import {
  registerCommand,
  parseCommandArgs,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import {
  isImageFile,
  isImageCard,
  findAttachedImage,
  extractExif,
  type ImageAnalysis,
} from "./describe-images-helpers.js";
import {
  analyzeBatchWithRetry,
  mergeUsage,
  BATCH_SIZE,
  type BatchItem,
  type BatchUsage,
} from "./describe-images-batch.js";
import {
  markCardInvalid,
  applyAnalysisToCard,
  renameCard,
} from "./describe-images-card.js";

export interface DescribeImagesArgs {
  paths: string[];
  noRename?: boolean;
}

const DescribeImagesArgsSchema = z.object({
  paths: z.array(z.string()).optional(),
  noRename: z.boolean().optional(),
});

/** Resolve each input path to a { cardPath, imagePath } batch item, warning on skips. */
async function resolveItems(
  ctx: CommandContext,
  paths: string[]
): Promise<BatchItem[]> {
  const items: BatchItem[] = [];

  for (const rawPath of paths) {
    const fullPath = path.isAbsolute(rawPath) ? rawPath : path.join(ctx.boxRoot, rawPath);

    if (isImageCard(fullPath)) {
      const imgPath = await findAttachedImage(fullPath);
      if (!imgPath) {
        // The card exists but its attachment doesn't (e.g. lost in a box
        // clone) — this is permanent, not transient, so mark the card
        // invalid now rather than leaving it "new" to be retried forever by
        // whatever procedure keeps re-running this command on it.
        ctx.writeLine(`Warning: No image file found for card ${rawPath}, marking invalid`);
        try {
          await markCardInvalid(fullPath, "Image file missing (attachment lost or never uploaded)");
        } catch (_e) {
          // Best-effort — don't let a status-update failure block resolving
          // the rest of the batch; a card left "new" here just gets retried.
        }
        continue;
      }
      items.push({ cardPath: fullPath, imagePath: imgPath, index: items.length });
    } else if (isImageFile(fullPath)) {
      const dir = path.dirname(fullPath);
      const baseName = path.basename(fullPath, path.extname(fullPath));
      const cardPath = path.join(dir, `${baseName}.image.card`);
      let existingCard: string | null = null;
      try {
        await fs.access(cardPath);
        existingCard = cardPath;
      } catch (_e) {
        // access() throws when no sibling .image.card exists yet — expected;
        // existingCard stays null and one gets created below.
      }
      items.push({ cardPath: existingCard, imagePath: fullPath, index: items.length });
    } else {
      ctx.writeLine(`Warning: ${rawPath} is not an image or image card, skipping`);
    }
  }

  return items;
}

interface AnalysisRun {
  analyses: ImageAnalysis[];
  usage: BatchUsage | null;
  failedCount: number;
}

/**
 * Chunk items into batches of BATCH_SIZE and analyze each. Batches that hit
 * RECITATION/MAX_TOKENS get split in half and retried; see analyzeBatchWithRetry.
 */
async function runAnalysisBatches({
  apiKey,
  items,
  ctx,
}: {
  apiKey: string;
  items: BatchItem[];
  ctx: CommandContext;
}): Promise<AnalysisRun> {
  const analyses: ImageAnalysis[] = [];
  let usage: BatchUsage | null = null;
  let failedCount = 0;

  for (let batchStart = 0; batchStart < items.length; batchStart += BATCH_SIZE) {
    const batchItems = items.slice(batchStart, batchStart + BATCH_SIZE);
    const outcome = await analyzeBatchWithRetry({ apiKey, batchItems, batchStart, ctx });
    analyses.push(...outcome.analyses);
    failedCount += outcome.failed;
    usage = mergeUsage(usage, outcome.usage);
  }

  return { analyses, usage, failedCount };
}

/** Print the analysis summary lines for one image to the command output. */
function reportAnalysis({
  ctx,
  relPath,
  analysis,
}: {
  ctx: CommandContext;
  relPath: string;
  analysis: ImageAnalysis;
}): void {
  ctx.writeLine(`\n${relPath}:`);
  ctx.writeLine(`  Title: ${analysis.title}`);
  ctx.writeLine(`  Description: ${analysis.description}`);
  if (analysis.has_text) {
    ctx.writeLine(`  Text blocks: ${analysis.text_blocks.length}`);
  }
  if (analysis.is_document) {
    const parts: string[] = [];
    if (analysis.document_kind) parts.push(`kind=${analysis.document_kind}`);
    if (analysis.document_from) parts.push(`from=${analysis.document_from}`);
    if (analysis.document_dates.length > 0) parts.push(`dates=${analysis.document_dates.length}`);
    ctx.writeLine(`  Document: ${parts.join(", ") || "(unlabeled)"}`);
  }
  if (analysis.invalid) {
    ctx.writeLine("  Status: invalid");
  }
  if (analysis.subject_bbox) {
    ctx.writeLine(`  Subject bbox: [${analysis.subject_bbox.join(", ")}]`);
  }
  if (analysis.rotation !== 0) {
    ctx.writeLine(`  Rotation: ${analysis.rotation}°`);
  }
}

/** Create a fresh image card for a raw image file and return its path. */
async function createImageCard(ctx: CommandContext, imagePath: string): Promise<string> {
  const baseName = path.basename(imagePath, path.extname(imagePath));
  const cardPath = path.join(path.dirname(imagePath), `${baseName}.image.card`);
  const now = new Date().toISOString();
  const fields = {
    type: "image",
    status: "new",
    filename: {
      ref: path.basename(imagePath),
      captured: now,
      source: "camera-environment",
    },
  };
  await fs.writeFile(cardPath, renderFrontmatterBlock(fields));
  ctx.writeLine(`  Created card: ${path.relative(ctx.boxRoot, cardPath)}`);
  return cardPath;
}

/** Mark a card invalid when no analysis came back for it (best-effort). */
async function handleMissingAnalysis(ctx: CommandContext, item: BatchItem): Promise<void> {
  ctx.writeLine(`Warning: No analysis returned for image ${item.index}`);
  // Mark the image card as invalid so it doesn't block the pipeline.
  // The assemble precheck only blocks on status="new" — "invalid" is
  // an accepted enum value and tells downstream steps to skip this image.
  if (!item.cardPath) return;
  try {
    await markCardInvalid(item.cardPath, "Image could not be analyzed (Gemini RECITATION filter blocked this image even with thinking disabled)");
    ctx.writeLine(`  Marked ${path.relative(ctx.boxRoot, item.cardPath)} as invalid (RECITATION)`);
  } catch (_e) {
    // Best-effort — don't fail the whole command over a status update
  }
}

/** Log the EXIF summary line for an image, if any fields are present. */
function reportExif(ctx: CommandContext, exif: Awaited<ReturnType<typeof extractExif>>): void {
  if (!exif) return;
  const exifParts = [];
  if (exif.date) exifParts.push(`date=${exif.date}`);
  if (exif.camera) exifParts.push(`camera=${exif.camera}`);
  if (exif.gps) exifParts.push(`gps=${exif.gps}`);
  if (exif.width && exif.height) exifParts.push(`${exif.width}x${exif.height}`);
  if (exifParts.length > 0) {
    ctx.writeLine(`  EXIF: ${exifParts.join(", ")}`);
  }
}

/** Apply one analysis: report it, ensure a card exists, write fields, rename. */
async function processItem({
  ctx,
  item,
  analysis,
  noRename,
}: {
  ctx: CommandContext;
  item: BatchItem;
  analysis: ImageAnalysis;
  noRename: boolean | undefined;
}): Promise<void> {
  const relPath = path.relative(ctx.boxRoot, item.cardPath || item.imagePath);
  reportAnalysis({ ctx, relPath, analysis });

  if (!item.cardPath) {
    item.cardPath = await createImageCard(ctx, item.imagePath);
  }

  const exif = await extractExif(item.imagePath);
  reportExif(ctx, exif);

  await applyAnalysisToCard({ cardPath: item.cardPath, analysis, exif });

  if (!noRename && analysis.title) {
    await renameCard(item.cardPath, { title: analysis.title, ctx });
  }
}

async function executeDescribeImages(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const { paths, noRename } = parseCommandArgs(args, DescribeImagesArgsSchema);

  if (!paths || paths.length === 0) {
    return { success: false, error: "At least one image path is required" };
  }

  const apiKey = process.env["GEMINI_KEY"] || process.env["SKE_GEMINI_API_KEY"];
  if (!apiKey) {
    return { success: false, error: "GEMINI_KEY environment variable is required" };
  }

  const items = await resolveItems(ctx, paths);
  if (items.length === 0) {
    // Every input path was handled inside resolveItems (marked invalid, or
    // simply wasn't an image/image-card) — nothing left to analyze isn't a
    // failure, it just means this call had no work.
    return { success: true, data: { analyzed: 0, total: 0, failed: 0, analyses: [] } };
  }

  ctx.writeLine(`Analyzing ${items.length} image(s) with Gemini Flash...`);

  try {
    const { analyses, usage, failedCount } = await runAnalysisBatches({ apiKey, items, ctx });

    if (failedCount > 0) {
      ctx.writeLine(`\n${failedCount} image(s) failed — ${analyses.length}/${items.length} images analyzed`);
    }

    for (const item of items) {
      const analysis = analyses.find((a) => a.index === item.index);
      if (!analysis) {
        await handleMissingAnalysis(ctx, item);
        continue;
      }
      await processItem({ ctx, item, analysis, noRename });
    }

    if (usage) {
      ctx.writeLine(`\nTokens: input=${usage.prompt}, output=${usage.output}, thinking=${usage.thinking}`);
    }

    const analyzedCount = analyses.length;
    if (analyzedCount === 0 && items.length > 0) {
      return {
        success: false,
        error: `All ${failedCount} image(s) failed — no images were analyzed`,
      };
    }

    return {
      success: true,
      data: { analyzed: analyzedCount, total: items.length, failed: failedCount, analyses },
    };
  } catch (error) {
    return {
      success: false,
      error: `Gemini API error: ${(error as Error).message}`,
    };
  }
}

registerCommand({
  name: "describe-images",
  description: "Analyze images using Gemini Flash (OCR, description, titles)",
  args: [
    {
      name: "paths",
      description: "Image files (.jpg/.png) or image cards (.image.card)",
      required: true,
      type: "string[]",
    },
    {
      name: "noRename",
      description: "Skip renaming files to descriptive names",
      required: false,
      default: false,
      type: "boolean",
    },
  ],
  execute: executeDescribeImages,
});

export { executeDescribeImages };
