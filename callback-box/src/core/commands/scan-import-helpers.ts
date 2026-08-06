/**
 * Helpers for the scan-import command.
 *
 * This module owns sliding-overlap batch planning and the backend-agnostic
 * batch runner: transient-error backoff, overlap-preserving split-retry, and
 * failure-inclusive usage/cost accounting, all driven by the
 * `ScanVisionBatchError.retry` classification the ScanVision service attaches
 * (`src/services/scan-vision.ts`). Pair reconciliation and bundling live in
 * `scan-import-reconcile.ts`. Both are re-exported here so the command and
 * its doctest keep importing from one place.
 */

import { invariant } from "../../lib/invariant.js";
import { sleep } from "../../lib/sleep.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import Sharp from "sharp";
import {
  type RawScanAnalysis,
  type ScanPageAnalysis,
  type BatchUsage,
} from "./scan-import-gemini.js";
import { ScanVisionBatchError, type ScanVisionService } from "../../services/scan-vision.js";
import { errorMessage } from "../../lib/error-guards.js";

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
  vision: ScanVisionService;
  imagePaths: string[];
  /** Pages per model call; defaults to the backend's own `batchSize`. */
  batchSize?: number;
  log?: (line: string) => void;
  /** Free-form context (names, eras, places) included in every model call. */
  boxholderContext?: string | null;
}

export interface RunScanBatchesResult {
  /** Map from global page index to all analyses produced for that page (1 or 2). */
  pageAnalyses: Map<number, ScanPageAnalysis[]>;
  /** Includes usage from failed/retried attempts, not just successes. */
  usage: BatchUsage | null;
  /** Dollars across all attempts, when the backend reports cost (Claude does). */
  costUsd: number | null;
  failed: number;
}

/**
 * Re-encode every archived page once before batch planning: honor EXIF
 * orientation, bound the long edge, and emit JPEG. The originals remain in
 * the archive for card emission; only these scratch files cross the service
 * boundary to Claude or Gemini.
 */
async function normalizeScanImages(
  imagePaths: string[],
): Promise<{ imagePaths: string[]; tempDir: string | null }> {
  const firstPath = imagePaths[0];
  if (firstPath === undefined) return { imagePaths: [], tempDir: null };

  const tempDir = await fs.mkdtemp(path.join(path.dirname(firstPath), ".scan-normalized-"));
  try {
    const normalizedPaths: string[] = [];
    for (const [index, imagePath] of imagePaths.entries()) {
      const outputPath = path.join(tempDir, `page-${String(index + 1).padStart(3, "0")}.jpg`);
      const buffer = await Sharp(imagePath)
        .rotate()
        .resize({
          width: 2000,
          height: 2000,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 88 })
        .toBuffer();
      await fs.writeFile(outputPath, buffer);
      normalizedPaths.push(outputPath);
    }
    return { imagePaths: normalizedPaths, tempDir };
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Run all batches with sliding overlap. Retry policy (per
 * `docs/plans/scan-vision-claude.md`): `transient` errors get up to 3
 * attempts with exponential backoff, then the batch fails; `split` errors
 * re-run as smaller overlap-preserving batches (singletons get one
 * `lastResort` re-attempt); `batch` errors fail the batch (its pages become
 * flagged placeholders downstream); `fatal` errors abort the whole run —
 * the provider/config is broken, and nothing has been staged yet.
 *
 * After a successful batch, batch-relative indices in each analysis (both
 * `index` and `paired_with_index`) are translated to global PDF page indices
 * before storing.
 */
export async function runScanBatches(args: RunScanBatchesArgs): Promise<RunScanBatchesResult> {
  const normalized = await normalizeScanImages(args.imagePaths);
  try {
    return await runNormalizedScanBatches({ ...args, imagePaths: normalized.imagePaths });
  } finally {
    if (normalized.tempDir !== null) {
      await fs.rm(normalized.tempDir, { recursive: true, force: true });
    }
  }
}

async function runNormalizedScanBatches(args: RunScanBatchesArgs): Promise<RunScanBatchesResult> {
  const { vision, imagePaths } = args;
  const batchSize = args.batchSize ?? vision.batchSize;
  const log = args.log ?? (() => {});
  const plans = planScanBatches(imagePaths.length, batchSize);

  const pageAnalyses = new Map<number, ScanPageAnalysis[]>();
  let totalUsage: BatchUsage | null = null;
  let totalCostUsd: number | null = null;
  let failed = 0;

  for (const plan of plans) {
    log(`Analyzing pages ${plan.globalIndices[0]}..${plan.globalIndices[plan.globalIndices.length - 1]} (${plan.globalIndices.length} pages)...`);
    const outcome = await runOneBatch({
      vision,
      plan,
      imagePaths,
      log,
      boxholderContext: args.boxholderContext ?? null,
    });
    failed += outcome.failed;
    totalUsage = addUsage(totalUsage, outcome.usage);
    totalCostUsd = addCost(totalCostUsd, outcome.costUsd);
    for (const analysis of outcome.analyses) {
      const list = pageAnalyses.get(analysis.index);
      if (list) {
        list.push(analysis);
      } else {
        pageAnalyses.set(analysis.index, [analysis]);
      }
    }
  }

  return { pageAnalyses, usage: totalUsage, costUsd: totalCostUsd, failed };
}

interface OneBatchOutcome {
  analyses: ScanPageAnalysis[];
  usage: BatchUsage | null;
  costUsd: number | null;
  failed: number;
}

/** Accumulate reported dollars; either side may be null (backend never reports). */
function addCost(total: number | null, next: number | null): number | null {
  if (next === null) return total;
  return (total ?? 0) + next;
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

/** Classify an analyzeBatch error; anything that isn't a ScanVisionBatchError
 *  is an unexpected bug and fails the batch (never silently retried). */
function retryClassOf(err: unknown): "transient" | "split" | "batch" | "fatal" {
  return err instanceof ScanVisionBatchError ? err.retry : "batch";
}

/** Pull the failed attempt's accounting off a ScanVisionBatchError. */
function errAccounting(err: unknown): { usage: BatchUsage | null; costUsd: number | null } {
  if (err instanceof ScanVisionBatchError) return { usage: err.usage, costUsd: err.costUsd };
  return { usage: null, costUsd: null };
}

interface RunOneBatchArgs {
  vision: ScanVisionService;
  plan: ScanBatchPlan;
  imagePaths: string[];
  log: (line: string) => void;
  boxholderContext?: string | null;
}

async function runOneBatch(args: RunOneBatchArgs): Promise<OneBatchOutcome> {
  const { plan, log } = args;
  const batchPaths = plan.globalIndices.map((g) => {
    const p = args.imagePaths[g];
    invariant(p !== undefined, "planScanBatches only emits indices within imagePaths' range");
    return p;
  });

  // Transient-error retry: try the same batch up to 3 times with exponential
  // backoff before giving up or splitting. Failed attempts still count toward
  // usage/cost, accumulated here and attached to the outcome.
  let failedUsage: BatchUsage | null = null;
  let failedCost: number | null = null;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const outcome = await attemptBatch(args, { batchPaths });
      return {
        ...outcome,
        usage: addUsage(failedUsage, outcome.usage),
        costUsd: addCost(failedCost, outcome.costUsd),
      };
    } catch (err) {
      const accounting = errAccounting(err);
      failedUsage = addUsage(failedUsage, accounting.usage);
      failedCost = addCost(failedCost, accounting.costUsd);
      lastErr = err;
      if (err instanceof ScanVisionBatchError && err.retry === "fatal") throw err;
      if (retryClassOf(err) !== "transient") break;
      const waitMs = 2000 * 2 ** attempt;
      log(`  Transient error, retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/3)...`);
      await sleep(waitMs);
    }
  }

  // Either non-transient failure or 3 transient retries exhausted.
  const failure = await handleBatchFailure(args, { batchPaths, err: lastErr });
  return {
    ...failure,
    usage: addUsage(failedUsage, failure.usage),
    costUsd: addCost(failedCost, failure.costUsd),
  };
}

/**
 * Run one model call and translate batch-relative indices to global ones,
 * dropping (and logging) entries the model invented past the batch end.
 */
async function attemptBatch(
  args: RunOneBatchArgs,
  { batchPaths, lastResort }: { batchPaths: string[]; lastResort?: boolean }
): Promise<OneBatchOutcome> {
  const result = await args.vision.analyzeBatch({
    imagePaths: batchPaths,
    boxholderContext: args.boxholderContext ?? null,
    lastResort: lastResort ?? false,
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
  return { analyses: translated, usage: result.usage, costUsd: result.costUsd, failed: 0 };
}

/**
 * Decide what to do after a batch has failed all its same-batch attempts:
 * abort the run on `fatal`, split on `split` (last-resort re-attempt at
 * singleton size), and otherwise fail the batch — its pages become flagged
 * placeholders downstream.
 */
async function handleBatchFailure(
  args: RunOneBatchArgs,
  { batchPaths, err }: { batchPaths: string[]; err: unknown }
): Promise<OneBatchOutcome> {
  const { plan, log } = args;
  const reason = errorMessage(err);
  log(`  Error: ${reason}`);
  if (err instanceof ScanVisionBatchError && err.retry === "fatal") throw err;
  if (retryClassOf(err) !== "split") {
    return { analyses: [], usage: null, costUsd: null, failed: plan.globalIndices.length };
  }
  if (plan.globalIndices.length === 1) {
    return retrySingletonLastResort(args, batchPaths);
  }
  return splitAndRerun(args);
}

/** Last-ditch retry of a single page (Gemini: thinking off; Claude: fresh sample). */
async function retrySingletonLastResort(
  args: RunOneBatchArgs,
  batchPaths: string[]
): Promise<OneBatchOutcome> {
  const { log } = args;
  log("  Retrying singleton as a last resort...");
  try {
    return await attemptBatch(args, { batchPaths, lastResort: true });
  } catch (retryErr) {
    if (retryErr instanceof ScanVisionBatchError && retryErr.retry === "fatal") throw retryErr;
    log(`  Still failed: ${errorMessage(retryErr)}`);
    const accounting = errAccounting(retryErr);
    return { analyses: [], usage: accounting.usage, costUsd: accounting.costUsd, failed: 1 };
  }
}

/**
 * Split a failed multi-page batch and re-run the halves. The halves SHARE
 * their boundary page (`[0,1,2]` → `[0,1]` + `[1,2]`) so an adjacent
 * photo/back pair stays co-visible in one of them — the same property
 * `planScanBatches` guarantees between planned batches; the reconciliation
 * layer merges the duplicate analyses of the shared page. A 2-page batch has
 * no pair-preserving split and falls back to plain singletons.
 */
async function splitAndRerun(args: RunOneBatchArgs): Promise<OneBatchOutcome> {
  const { plan, log } = args;
  const n = plan.globalIndices.length;
  const mid = Math.ceil(n / 2);
  const leftIndices = plan.globalIndices.slice(0, mid);
  const rightIndices = n >= 3 ? plan.globalIndices.slice(mid - 1) : plan.globalIndices.slice(mid);
  log(`  Splitting into ${leftIndices.length} + ${rightIndices.length}${n >= 3 ? " (overlapping)" : ""}`);
  const left = await runOneBatch({ ...args, plan: { globalIndices: leftIndices } });
  const right = await runOneBatch({ ...args, plan: { globalIndices: rightIndices } });
  return {
    analyses: [...left.analyses, ...right.analyses],
    usage: addUsage(left.usage, right.usage),
    costUsd: addCost(left.costUsd, right.costUsd),
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
  if (raw.paired_with_index !== null) {
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
