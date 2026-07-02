/**
 * Helpers for the scan-import command.
 *
 * This module owns sliding-overlap batch planning and the batch runner
 * (including transient-error backoff and RECITATION/MAX_TOKENS split-retry).
 * The per-image Gemini analysis lives in `scan-import-gemini.ts`; pair
 * reconciliation and bundling live in `scan-import-reconcile.ts`. Both are
 * re-exported here so the command and its doctest keep importing from one
 * place.
 */

import { sleep } from "../../lib/sleep.js";
import {
  analyzeScanBatchWithGemini,
  type RawScanAnalysis,
  type ScanPageAnalysis,
  type BatchUsage,
} from "./scan-import-gemini.js";
import { GeminiEmptyResponseError } from "./describe-images-helpers.js";

export { buildScanPrompt } from "./scan-import-gemini.js";
export type { ScanPageAnalysis, BatchUsage } from "./scan-import-gemini.js";
export {
  resolveScanPages,
  bundleResolvedPages,
  type ResolvedPage,
  type PhotoBundle,
  type OrphanBack,
  type BundleResult,
} from "./scan-import-reconcile.js";

class InvalidBatchSizeError extends Error {
  constructor() {
    super("batchSize must be >= 2");
    this.name = "InvalidBatchSizeError";
  }
}

export interface ScanBatchPlan {
  /** Global indices of pages in this batch, in order. */
  globalIndices: number[];
}

/**
 * Plan sliding-overlap batches across N pages. Each batch is `batchSize`
 * pages, and consecutive batches share their boundary page so any pair that
 * straddles a seam is covered by one of the two batches.
 *
 * For batchSize=8, N=20:
 *   [0,1,2,3,4,5,6,7], [7,8,9,10,11,12,13,14], [14,15,16,17,18,19]
 */
export function planScanBatches(totalPages: number, batchSize: number): ScanBatchPlan[] {
  if (batchSize < 2) throw new InvalidBatchSizeError();
  if (totalPages === 0) return [];
  if (totalPages <= batchSize) {
    return [{ globalIndices: Array.from({ length: totalPages }, (_, i) => i) }];
  }
  const plans: ScanBatchPlan[] = [];
  let start = 0;
  while (start < totalPages) {
    const end = Math.min(start + batchSize, totalPages);
    const indices = [];
    for (let i = start; i < end; i++) indices.push(i);
    plans.push({ globalIndices: indices });
    if (end >= totalPages) break;
    // Next batch starts on the LAST page of this batch — sliding overlap of 1.
    start = end - 1;
  }
  return plans;
}

export interface RunScanBatchesArgs {
  apiKey: string;
  imagePaths: string[];
  batchSize?: number;
  log?: (line: string) => void;
  /** Free-form context (names, eras, places) included in every Gemini call. */
  boxholderContext?: string | null;
}

export interface RunScanBatchesResult {
  /** Map from global page index to all analyses produced for that page (1 or 2). */
  pageAnalyses: Map<number, ScanPageAnalysis[]>;
  usage: BatchUsage | null;
  failed: number;
}

/**
 * Run all batches with sliding overlap, retrying RECITATION/MAX_TOKENS by
 * splitting the batch in half (mirrors describe-images.ts behavior).
 *
 * After a successful batch, batch-relative indices in each analysis (both
 * `index` and `paired_with_index`) are translated to global PDF page indices
 * before storing.
 */
export async function runScanBatches(args: RunScanBatchesArgs): Promise<RunScanBatchesResult> {
  const { apiKey, imagePaths } = args;
  const batchSize = args.batchSize ?? 8;
  const log = args.log ?? (() => {});
  const plans = planScanBatches(imagePaths.length, batchSize);

  const pageAnalyses = new Map<number, ScanPageAnalysis[]>();
  let totalUsage: BatchUsage | null = null;
  let failed = 0;

  for (const plan of plans) {
    log(`Analyzing pages ${plan.globalIndices[0]}..${plan.globalIndices[plan.globalIndices.length - 1]} (${plan.globalIndices.length} pages)...`);
    const outcome = await runOneBatch({
      apiKey,
      plan,
      imagePaths,
      log,
      boxholderContext: args.boxholderContext ?? null,
    });
    failed += outcome.failed;
    totalUsage = addUsage(totalUsage, outcome.usage);
    for (const analysis of outcome.analyses) {
      const list = pageAnalyses.get(analysis.index);
      if (list) {
        list.push(analysis);
      } else {
        pageAnalyses.set(analysis.index, [analysis]);
      }
    }
  }

  return { pageAnalyses, usage: totalUsage, failed };
}

interface OneBatchOutcome {
  analyses: ScanPageAnalysis[];
  usage: BatchUsage | null;
  failed: number;
}

/** Accumulate batch token usage; either side may be null. */
function addUsage(total: BatchUsage | null, next: BatchUsage | null): BatchUsage | null {
  if (!next) return total;
  if (!total) return { ...next };
  return {
    prompt: total.prompt + next.prompt,
    output: total.output + next.output,
    thinking: total.thinking + next.thinking,
  };
}

/**
 * Detect transient Gemini errors that warrant a backoff-and-retry on the
 * same batch (as opposed to splitting). Covers UNAVAILABLE/503 capacity
 * spikes and RESOURCE_EXHAUSTED/429 quota throttling.
 */
function isTransientGeminiError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  return (
    msg.includes('"code":503') ||
    msg.includes('"code":429') ||
    msg.includes("UNAVAILABLE") ||
    msg.includes("RESOURCE_EXHAUSTED")
  );
}


interface RunOneBatchArgs {
  apiKey: string;
  plan: ScanBatchPlan;
  imagePaths: string[];
  log: (line: string) => void;
  thinkingBudget?: number;
  boxholderContext?: string | null;
}

async function runOneBatch(args: RunOneBatchArgs): Promise<OneBatchOutcome> {
  const { plan, log } = args;
  const batchPaths = plan.globalIndices.map((g) => args.imagePaths[g]!);

  // Transient-error retry: try the same batch up to 3 times with exponential
  // backoff before giving up or splitting.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await attemptBatch(args, batchPaths);
    } catch (err) {
      lastErr = err;
      if (!isTransientGeminiError(err)) break;
      const waitMs = 2000 * 2 ** attempt;
      log(`  Transient error, retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/3)...`);
      await sleep(waitMs);
    }
  }

  // Either non-transient failure or 3 transient retries exhausted.
  return handleBatchFailure(args, { batchPaths, err: lastErr });
}

/**
 * Run one Gemini call and translate batch-relative indices to global ones,
 * dropping (and logging) entries the model invented past the batch end.
 */
async function attemptBatch(
  args: RunOneBatchArgs,
  batchPaths: string[]
): Promise<OneBatchOutcome> {
  const result = await analyzeScanBatchWithGemini(args.apiKey, {
    imagePaths: batchPaths,
    boxholderContext: args.boxholderContext ?? null,
    ...(args.thinkingBudget !== undefined ? { thinkingBudget: args.thinkingBudget } : {}),
  });
  const translated: ScanPageAnalysis[] = [];
  let dropped = 0;
  for (const raw of result.analyses) {
    const t = translateIndices(raw, args.plan.globalIndices);
    if (t === null) {
      dropped++;
      continue;
    }
    translated.push(t);
  }
  if (dropped > 0) {
    args.log(`  Warning: dropped ${dropped} analysis entries with out-of-range indices`);
  }
  return { analyses: translated, usage: result.usage, failed: 0 };
}

/**
 * Decide what to do after a batch has failed all its same-batch attempts:
 * give up on non-retryable errors, retry a singleton with thinking disabled,
 * or split a multi-page batch in half and recurse.
 */
async function handleBatchFailure(
  args: RunOneBatchArgs,
  { batchPaths, err }: { batchPaths: string[]; err: unknown }
): Promise<OneBatchOutcome> {
  const { plan, log } = args;
  const reason = (err as Error).message;
  log(`  Error: ${reason}`);
  const retryable =
    err instanceof GeminiEmptyResponseError &&
    (err.finishReason === "RECITATION" || err.finishReason === "MAX_TOKENS");
  if (!retryable) {
    return { analyses: [], usage: null, failed: plan.globalIndices.length };
  }
  if (plan.globalIndices.length === 1) {
    return retrySingletonWithoutThinking(args, batchPaths);
  }
  return splitAndRerun(args);
}

/** Last-ditch retry of a single page with thinking turned off. */
async function retrySingletonWithoutThinking(
  args: RunOneBatchArgs,
  batchPaths: string[]
): Promise<OneBatchOutcome> {
  const { plan, log } = args;
  log("  Retrying singleton with thinking disabled...");
  try {
    const result = await analyzeScanBatchWithGemini(args.apiKey, {
      imagePaths: batchPaths,
      thinkingBudget: 0,
      boxholderContext: args.boxholderContext ?? null,
    });
    const translated: ScanPageAnalysis[] = [];
    for (const raw of result.analyses) {
      const t = translateIndices(raw, plan.globalIndices);
      if (t !== null) translated.push(t);
    }
    return { analyses: translated, usage: result.usage, failed: 0 };
  } catch (retryErr) {
    log(`  Still failed: ${(retryErr as Error).message}`);
    return { analyses: [], usage: null, failed: 1 };
  }
}

/** Split a multi-page batch in half, run each side, and merge the outcomes. */
async function splitAndRerun(args: RunOneBatchArgs): Promise<OneBatchOutcome> {
  const { plan, log } = args;
  const mid = Math.ceil(plan.globalIndices.length / 2);
  log(`  Splitting into ${mid} + ${plan.globalIndices.length - mid}`);
  const leftPlan: ScanBatchPlan = { globalIndices: plan.globalIndices.slice(0, mid) };
  const rightPlan: ScanBatchPlan = { globalIndices: plan.globalIndices.slice(mid) };
  const left = await runOneBatch({ ...args, plan: leftPlan });
  const right = await runOneBatch({ ...args, plan: rightPlan });
  return {
    analyses: [...left.analyses, ...right.analyses],
    usage: addUsage(left.usage, right.usage),
    failed: left.failed + right.failed,
  };
}

function translateIndices(raw: RawScanAnalysis, globalIndices: number[]): ScanPageAnalysis | null {
  const globalIndex = globalIndices[raw.index];
  if (globalIndex === undefined) {
    // Model occasionally invents an extra index past the end of the batch.
    // Skip the bad entry; missing pages get a placeholder via resolveScanPages.
    return null;
  }
  let pairedGlobal: number | null = null;
  if (raw.paired_with_index !== null && raw.paired_with_index !== undefined) {
    const partner = globalIndices[raw.paired_with_index];
    if (partner !== undefined) pairedGlobal = partner;
  }
  return {
    index: globalIndex,
    kind: raw.kind,
    paired_with_index: pairedGlobal,
    description: raw.description,
    title: raw.title,
    rotation: raw.rotation,
    subject_bbox: raw.subject_bbox,
    has_text: raw.has_text,
    text_blocks: raw.text_blocks,
    date_hint: raw.date_hint,
    flag_for_review: raw.flag_for_review,
    flag_reason: raw.flag_reason,
  };
}
