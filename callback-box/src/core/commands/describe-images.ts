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
import {
  registerCommand,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import { createLoader } from "../../cli/lib/loader.js";
import { parseCardName } from "../../cli/lib/paths.js";
import {
  isImageFile,
  isImageCard,
  findAttachedImage,
  extractExif,
  analyzeImagesWithGemini,
  type ImageAnalysis,
} from "./describe-images-helpers.js";

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
  const items: Array<{
    cardPath: string | null;
    imagePath: string;
    index: number;
  }> = [];

  const loader = await createLoader(ctx.boxRoot);

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
      } catch {
        // No existing card
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
    // Chunk into batches of 8 to avoid Gemini payload limits with large images
    const BATCH_SIZE = 8;
    const analyses: ImageAnalysis[] = [];
    let totalUsage: { prompt: number; output: number; thinking: number } | null = null;

    let batchErrors = 0;
    for (let batchStart = 0; batchStart < items.length; batchStart += BATCH_SIZE) {
      const batchItems = items.slice(batchStart, batchStart + BATCH_SIZE);
      const batchPaths = batchItems.map((item) => item.imagePath);
      try {
        const result = await analyzeImagesWithGemini(apiKey, { imagePaths: batchPaths });

        // Remap indices back to the global item indices
        for (const a of result.analyses) {
          a.index = a.index + batchStart;
          analyses.push(a);
        }

        if (result.usage) {
          if (!totalUsage) {
            totalUsage = { ...result.usage };
          } else {
            totalUsage.prompt += result.usage.prompt;
            totalUsage.output += result.usage.output;
            totalUsage.thinking += result.usage.thinking;
          }
        }
      } catch (batchErr) {
        batchErrors++;
        const batchEnd = Math.min(batchStart + BATCH_SIZE, items.length);
        ctx.writeLine(`\nError analyzing batch ${batchStart}-${batchEnd - 1} (${batchItems.length} images): ${(batchErr as Error).message}`);
      }
    }

    if (batchErrors > 0) {
      ctx.writeLine(`\n${batchErrors} batch(es) failed — ${analyses.length}/${items.length} images analyzed`);
    }

    const usage = totalUsage;

    for (const item of items) {
      const analysis = analyses.find((a) => a.index === item.index);
      if (!analysis) {
        ctx.writeLine(`Warning: No analysis returned for image ${item.index}`);
        continue;
      }

      const relPath = path.relative(ctx.boxRoot, item.cardPath || item.imagePath);
      ctx.writeLine(`\n${relPath}:`);
      ctx.writeLine(`  Title: ${analysis.title}`);
      ctx.writeLine(`  Description: ${analysis.description}`);
      if (analysis.has_text) {
        ctx.writeLine(`  Text blocks: ${analysis.text_blocks.length}`);
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
        const cardXml = [
          "<image status=\"new\">",
          `<filename name="${path.basename(item.imagePath)}" captured="${now}" source="camera-environment" />`,
          "<description></description>",
          "</image>",
        ].join("\n") + "\n";
        await fs.writeFile(cardPath, cardXml);
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

      await applyAnalysisToCard(loader, { cardPath: item.cardPath, analysis, exif });

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
        error: `All ${batchErrors} batch(es) failed — no images were analyzed`,
      };
    }

    return {
      success: true,
      data: { analyzed: analyzedCount, total: items.length, batchErrors, analyses },
    };
  } catch (error) {
    return {
      success: false,
      error: `Gemini API error: ${(error as Error).message}`,
    };
  }
}

async function applyAnalysisToCard(
  loader: Awaited<ReturnType<typeof createLoader>>,
  { cardPath, analysis, exif }: { cardPath: string; analysis: ImageAnalysis; exif: Awaited<ReturnType<typeof extractExif>> }
): Promise<void> {
  const card = await loader.load(cardPath);
  const el = card.element;

  el.attrs["status"] = analysis.invalid ? "invalid" : "analyzed";
  el.attrs["has-text"] = analysis.has_text ? "true" : "false";
  if (analysis.rotation !== 0) {
    el.attrs["rotation"] = String(analysis.rotation);
  }

  const descChild = el.children.find((c) => c.tagName === "description");
  if (descChild) {
    descChild.text = analysis.description;
  }

  // Update captured date from EXIF if available
  if (exif && exif.date) {
    const filenameChild = el.children.find((c) => c.tagName === "filename");
    if (filenameChild) {
      filenameChild.attrs["captured"] = exif.date;
    }
  }

  // Remove old text, exif, and subject-bbox children, add new ones
  el.children = el.children.filter((c) => c.tagName !== "text" && c.tagName !== "exif" && c.tagName !== "subject-bbox");
  for (const block of analysis.text_blocks) {
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

  if (exif) {
    const exifAttrs: Record<string, string> = {};
    if (exif.date) exifAttrs["date"] = exif.date;
    if (exif.camera) exifAttrs["camera"] = exif.camera;
    if (exif.gps) exifAttrs["gps"] = exif.gps;
    if (exif.width) exifAttrs["width"] = exif.width;
    if (exif.height) exifAttrs["height"] = exif.height;
    el.children.push({
      tagName: "exif",
      attrs: exifAttrs,
      text: "",
      children: [],
      comments: {},
      location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
      dirty: true,
    });
  }

  if (analysis.subject_bbox && analysis.subject_bbox.length === 4) {
    el.children.push({
      tagName: "subject-bbox",
      attrs: {
        y1: String(analysis.subject_bbox[0]),
        x1: String(analysis.subject_bbox[1]),
        y2: String(analysis.subject_bbox[2]),
        x2: String(analysis.subject_bbox[3]),
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
