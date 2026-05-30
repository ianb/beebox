/**
 * Batch orchestration for the describe-images command.
 *
 * Chunks images into Gemini batches and retries failures by splitting the
 * batch in half (RECITATION / MAX_TOKENS) or disabling thinking on a stubborn
 * single image. Pure analysis-side logic — no card I/O lives here.
 */

import { type CommandContext } from "../command-runner.js";
import {
  analyzeImagesWithGemini,
  GeminiEmptyResponseError,
  type ImageAnalysis,
} from "./describe-images-helpers.js";

export interface BatchItem {
  cardPath: string | null;
  imagePath: string;
  index: number;
}

export interface BatchUsage {
  prompt: number;
  output: number;
  thinking: number;
}

interface BatchOutcome {
  analyses: ImageAnalysis[];
  usage: BatchUsage | null;
  failed: number;
}

/** Chunk images into batches of 8 to avoid Gemini payload limits. */
export const BATCH_SIZE = 8;

/** Add `right`'s token counts into `left`, returning a fresh total. */
export function mergeUsage(
  left: BatchUsage | null,
  right: BatchUsage | null
): BatchUsage | null {
  if (!left) return right ? { ...right } : null;
  if (!right) return { ...left };
  return {
    prompt: left.prompt + right.prompt,
    output: left.output + right.output,
    thinking: left.thinking + right.thinking,
  };
}

/** Shift analysis indices by `batchStart` so they map back to global items. */
function reindex(analyses: ImageAnalysis[], batchStart: number): ImageAnalysis[] {
  const out: ImageAnalysis[] = [];
  for (const a of analyses) {
    a.index = a.index + batchStart;
    out.push(a);
  }
  return out;
}

/**
 * A single image hit RECITATION on its own — try once more with thinking
 * disabled. Without internal reasoning, the model is less likely to reproduce
 * document text that triggers the recitation filter.
 */
async function retrySingleWithoutThinking({
  apiKey,
  batchPaths,
  batchStart,
  ctx,
}: {
  apiKey: string;
  batchPaths: string[];
  batchStart: number;
  ctx: CommandContext;
}): Promise<BatchOutcome> {
  ctx.writeLine("  Retrying single image with thinking disabled...");
  try {
    const result = await analyzeImagesWithGemini(apiKey, {
      imagePaths: batchPaths,
      thinkingBudget: 0,
    });
    return { analyses: reindex(result.analyses, batchStart), usage: result.usage, failed: 0 };
  } catch (retryErr) {
    ctx.writeLine(`  Still failed: ${(retryErr as Error).message}`);
    return { analyses: [], usage: null, failed: 1 };
  }
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
export async function analyzeBatchWithRetry({
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
    return { analyses: reindex(result.analyses, batchStart), usage: result.usage, failed: 0 };
  } catch (err) {
    ctx.writeLine(`\nError analyzing batch ${batchStart}-${batchEnd} (${batchItems.length} images): ${(err as Error).message}`);
    const retryable =
      err instanceof GeminiEmptyResponseError &&
      (err.finishReason === "RECITATION" || err.finishReason === "MAX_TOKENS");
    if (!retryable) {
      return { analyses: [], usage: null, failed: batchItems.length };
    }
    if (batchItems.length === 1) {
      return retrySingleWithoutThinking({ apiKey, batchPaths, batchStart, ctx });
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
    return {
      analyses: [...left.analyses, ...right.analyses],
      usage: mergeUsage(left.usage, right.usage),
      failed: left.failed + right.failed,
    };
  }
}
