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
import { stringify as stringifyYaml } from "yaml";
import {
  registerCommand,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import { parseCardName } from "../../cli/lib/paths.js";
import { parseCardText, serializeCardText } from "../card-io.js";
import { createCardSchemaMap } from "../../schemas/registry.js";
import { type ImageFields } from "../../schemas/image.js";
import {
  isImageFile,
  isImageCard,
  findAttachedImage,
  extractExif,
  analyzeImagesWithGemini,
  GeminiEmptyResponseError,
  type ImageAnalysis,
} from "./describe-images-helpers.js";

interface BatchItem {
  cardPath: string | null;
  imagePath: string;
  index: number;
}

interface BatchUsage {
  prompt: number;
  output: number;
  thinking: number;
}

interface BatchOutcome {
  analyses: ImageAnalysis[];
  usage: BatchUsage | null;
  failed: number;
}

/**
 * Run one Gemini batch. If it fails with RECITATION or MAX_TOKENS — both
 * symptoms of "too much content for one call" — split the batch in half and
 * recurse on each side. Single-image batches that fail are counted as failed
 * and skipped. Other errors (network, schema, etc.) abort the whole batch.
 *
 * Why split on these specific reasons: RECITATION fires when the model
 * internally reproduces enough verbatim training-data text; it scales with
 * batch size. MAX_TOKENS means the response was truncated and likely won't
 * parse. Other reasons (SAFETY, BLOCKLIST, etc.) won't get better with smaller
 * batches.
 */
async function analyzeBatchWithRetry({
  apiKey,
  batchItems,
  batchStart,
  ctx,
}: {
  apiKey: string;
  batchItems: BatchItem[];
  batchStart: number;
  ctx: CommandContext;
}): Promise<BatchOutcome> {
  const batchPaths = batchItems.map((item) => item.imagePath);
  const batchEnd = batchStart + batchItems.length - 1;
  try {
    const result = await analyzeImagesWithGemini(apiKey, { imagePaths: batchPaths });
    const analyses: ImageAnalysis[] = [];
    for (const a of result.analyses) {
      a.index = a.index + batchStart;
      analyses.push(a);
    }
    return { analyses, usage: result.usage, failed: 0 };
  } catch (err) {
    ctx.writeLine(`\nError analyzing batch ${batchStart}-${batchEnd} (${batchItems.length} images): ${(err as Error).message}`);
    const retryable =
      err instanceof GeminiEmptyResponseError &&
      (err.finishReason === "RECITATION" || err.finishReason === "MAX_TOKENS");
    if (!retryable) {
      return { analyses: [], usage: null, failed: batchItems.length };
    }
    // Single-image batch still hitting RECITATION — try once more with
    // thinking disabled. Without internal reasoning, the model is less
    // likely to reproduce document text that triggers the recitation filter.
    if (batchItems.length === 1) {
      ctx.writeLine("  Retrying single image with thinking disabled...");
      try {
        const result = await analyzeImagesWithGemini(apiKey, {
          imagePaths: batchPaths,
          thinkingBudget: 0,
        });
        const analyses: ImageAnalysis[] = [];
        for (const a of result.analyses) {
          a.index = a.index + batchStart;
          analyses.push(a);
        }
        return { analyses, usage: result.usage, failed: 0 };
      } catch (retryErr) {
        ctx.writeLine(`  Still failed: ${(retryErr as Error).message}`);
        return { analyses: [], usage: null, failed: 1 };
      }
    }
    const mid = Math.ceil(batchItems.length / 2);
    ctx.writeLine(`  Retrying as two smaller batches: ${mid} + ${batchItems.length - mid}`);
    const left = await analyzeBatchWithRetry({
      apiKey,
      batchItems: batchItems.slice(0, mid),
      batchStart,
      ctx,
    });
    const right = await analyzeBatchWithRetry({
      apiKey,
      batchItems: batchItems.slice(mid),
      batchStart: batchStart + mid,
      ctx,
    });
    let usage: BatchUsage | null = null;
    if (left.usage) usage = { ...left.usage };
    if (right.usage) {
      if (usage) {
        usage.prompt += right.usage.prompt;
        usage.output += right.usage.output;
        usage.thinking += right.usage.thinking;
      } else {
        usage = { ...right.usage };
      }
    }
    return {
      analyses: [...left.analyses, ...right.analyses],
      usage,
      failed: left.failed + right.failed,
    };
  }
}

export interface DescribeImagesArgs {
  paths: string[];
  noRename?: boolean;
}

async function executeDescribeImages(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const { paths, noRename } = args as unknown as DescribeImagesArgs;

  if (!paths || paths.length === 0) {
    return { success: false, error: "At least one image path is required" };
  }

  const apiKey = process.env["GEMINI_KEY"] || process.env["SKE_GEMINI_API_KEY"];
  if (!apiKey) {
    return { success: false, error: "GEMINI_KEY environment variable is required" };
  }

  // Resolve each path to { cardPath, imagePath }
  const items: BatchItem[] = [];

  for (const rawPath of paths) {
    const fullPath = path.isAbsolute(rawPath) ? rawPath : path.join(ctx.boxRoot, rawPath);

    if (isImageCard(fullPath)) {
      const imgPath = await findAttachedImage(fullPath);
      if (!imgPath) {
        ctx.writeLine(`Warning: No image file found for card ${rawPath}, skipping`);
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

  if (items.length === 0) {
    return { success: false, error: "No valid images found" };
  }

  ctx.writeLine(`Analyzing ${items.length} image(s) with Gemini Flash...`);

  try {
    // Chunk into batches of 8 to avoid Gemini payload limits with large images.
    // Batches that hit RECITATION/MAX_TOKENS get split in half and retried;
    // see analyzeBatchWithRetry.
    const BATCH_SIZE = 8;
    const analyses: ImageAnalysis[] = [];
    let totalUsage: BatchUsage | null = null;
    let failedCount = 0;

    for (let batchStart = 0; batchStart < items.length; batchStart += BATCH_SIZE) {
      const batchItems = items.slice(batchStart, batchStart + BATCH_SIZE);
      const outcome = await analyzeBatchWithRetry({
        apiKey,
        batchItems,
        batchStart,
        ctx,
      });
      analyses.push(...outcome.analyses);
      failedCount += outcome.failed;
      if (outcome.usage) {
        if (!totalUsage) {
          totalUsage = { ...outcome.usage };
        } else {
          totalUsage.prompt += outcome.usage.prompt;
          totalUsage.output += outcome.usage.output;
          totalUsage.thinking += outcome.usage.thinking;
        }
      }
    }

    if (failedCount > 0) {
      ctx.writeLine(`\n${failedCount} image(s) failed — ${analyses.length}/${items.length} images analyzed`);
    }

    const usage = totalUsage;

    for (const item of items) {
      const analysis = analyses.find((a) => a.index === item.index);
      if (!analysis) {
        ctx.writeLine(`Warning: No analysis returned for image ${item.index}`);
        // Mark the image card as invalid so it doesn't block the pipeline.
        // The assemble precheck only blocks on status="new" — "invalid" is
        // an accepted enum value and tells downstream steps to skip this image.
        if (item.cardPath) {
          try {
            await markCardInvalid(item.cardPath, "Image could not be analyzed (Gemini RECITATION filter blocked this image even with thinking disabled)");
            ctx.writeLine(`  Marked ${path.relative(ctx.boxRoot, item.cardPath)} as invalid (RECITATION)`);
          } catch (_e) {
            // Best-effort — don't fail the whole command over a status update
          }
        }
        continue;
      }

      const relPath = path.relative(ctx.boxRoot, item.cardPath || item.imagePath);
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

      // Create card if it doesn't exist
      if (!item.cardPath) {
        const baseName = path.basename(item.imagePath, path.extname(item.imagePath));
        const cardPath = path.join(path.dirname(item.imagePath), `${baseName}.image.card`);
        const now = new Date().toISOString();
        const fields = {
          type: "image",
          status: "new",
          filename: {
            ref: path.basename(item.imagePath),
            captured: now,
            source: "camera-environment",
          },
        };
        await fs.writeFile(cardPath, `---\n${stringifyYaml(fields)}---\n`);
        item.cardPath = cardPath;
        ctx.writeLine(`  Created card: ${path.relative(ctx.boxRoot, cardPath)}`);
      }

      // Extract EXIF data from the image file
      const exif = await extractExif(item.imagePath);
      if (exif) {
        const exifParts = [];
        if (exif.date) exifParts.push(`date=${exif.date}`);
        if (exif.camera) exifParts.push(`camera=${exif.camera}`);
        if (exif.gps) exifParts.push(`gps=${exif.gps}`);
        if (exif.width && exif.height) exifParts.push(`${exif.width}x${exif.height}`);
        if (exifParts.length > 0) {
          ctx.writeLine(`  EXIF: ${exifParts.join(", ")}`);
        }
      }

      await applyAnalysisToCard({ cardPath: item.cardPath, analysis, exif });

      // Rename if requested
      if (!noRename && analysis.title) {
        await renameCard(item.cardPath, { title: analysis.title, ctx });
      }
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

async function loadImageCard(cardPath: string): Promise<ImageFields> {
  const content = await fs.readFile(cardPath, "utf-8");
  const parsed = parseCardText(content, {
    source: cardPath,
    schemas: createCardSchemaMap(),
  });
  return parsed.fields as unknown as ImageFields;
}

async function saveImageCard(cardPath: string, fields: ImageFields): Promise<void> {
  const parsed = parseCardText(`---\n${stringifyYaml(fields)}---\n`, {
    source: cardPath,
    schemas: createCardSchemaMap(),
  });
  await fs.writeFile(cardPath, serializeCardText({
    schema: parsed.schema,
    fields: fields as unknown as Record<string, unknown>,
  }));
}

async function markCardInvalid(cardPath: string, description: string): Promise<void> {
  const fields = await loadImageCard(cardPath);
  if (fields.status !== "new") return;
  fields.status = "invalid";
  fields.description = description;
  await saveImageCard(cardPath, fields);
}

async function applyAnalysisToCard(input: {
  cardPath: string;
  analysis: ImageAnalysis;
  exif: Awaited<ReturnType<typeof extractExif>>;
}): Promise<void> {
  const { cardPath, analysis, exif } = input;
  const fields = await loadImageCard(cardPath);

  fields.status = analysis.invalid ? "invalid" : "analyzed";
  // Documents always count as has-text, even if the model forgot to set it.
  fields["has-text"] = analysis.has_text || analysis.is_document;
  if (analysis.rotation !== 0) {
    fields.rotation = String(analysis.rotation) as NonNullable<ImageFields["rotation"]>;
  } else {
    delete fields.rotation;
  }

  fields.description = analysis.description;

  // Update captured date from EXIF if the card doesn't already have one.
  if (exif && exif.date && !fields.filename.captured) {
    fields.filename.captured = exif.date;
  }

  // Replace text / exif / subject-bbox / document with the new analysis.
  if (analysis.text_blocks.length > 0) {
    fields.text = analysis.text_blocks.map((b) => ({
      source: b.source,
      content: b.text,
    }));
  } else {
    delete fields.text;
  }

  if (exif) {
    const exifFields: NonNullable<ImageFields["exif"]> = {};
    if (exif.date) exifFields.date = exif.date;
    if (exif.camera) exifFields.camera = exif.camera;
    if (exif.gps) exifFields.gps = exif.gps;
    if (exif.width) exifFields.width = exif.width;
    if (exif.height) exifFields.height = exif.height;
    fields.exif = exifFields;
  } else {
    delete fields.exif;
  }

  if (analysis.subject_bbox && analysis.subject_bbox.length === 4) {
    fields["subject-bbox"] = {
      y1: String(analysis.subject_bbox[0]),
      x1: String(analysis.subject_bbox[1]),
      y2: String(analysis.subject_bbox[2]),
      x2: String(analysis.subject_bbox[3]),
    };
  } else {
    delete fields["subject-bbox"];
  }

  if (analysis.is_document) {
    const doc: NonNullable<ImageFields["document"]> = {};
    if (analysis.document_kind) doc.kind = analysis.document_kind;
    if (analysis.document_from) doc.from = analysis.document_from;
    if (analysis.document_dates.length > 0) {
      doc.dates = analysis.document_dates.map((d) => ({ label: d.label, value: d.value }));
    }
    fields.document = doc;
  } else {
    delete fields.document;
  }

  await saveImageCard(cardPath, fields);
}

async function renameCard(
  cardPath: string,
  { title, ctx }: { title: string; ctx: CommandContext }
): Promise<void> {
  const currentName = parseCardName(path.basename(cardPath));
  if (!currentName) return;

  const prefixMatch = currentName.name.match(/^(photo-\d+|audio-\d+|img-\d+)/);
  const prefix = prefixMatch ? prefixMatch[1] : null;
  const newName = prefix ? `${prefix}-${title}` : title;
  const newCardName = `${newName}.image.card`;
  const newCardPath = path.join(path.dirname(cardPath), newCardName);

  if (newCardPath === cardPath) return;

  try {
    const { runCommand } = await import("../command-runner.js");
    await runCommand({
      name: "move",
      args: {
        from: path.relative(ctx.boxRoot, cardPath),
        to: path.relative(ctx.boxRoot, newCardPath),
      },
      ctx,
    });
  } catch (err) {
    ctx.writeLine(`  Warning: Failed to rename: ${(err as Error).message}`);
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
