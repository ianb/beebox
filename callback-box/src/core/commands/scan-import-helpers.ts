/**
 * Helpers for the scan-import command.
 *
 * PDF page rendering via pdftoppm, scan-mode Gemini analysis (per-page
 * description + photo/back pairing), sliding-overlap batching, and pair
 * reconciliation across overlapping batches.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { GoogleGenAI } from "@google/genai";
import { getMimeType, GeminiEmptyResponseError } from "./describe-images-helpers.js";

/**
 * Spawn a child process and reject on non-zero exit. Captures stderr in the
 * error message so failures from pdftoppm surface usefully.
 */
async function runProcess(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${cmd} exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

export interface RenderPdfOptions {
  pdfPath: string;
  outDir: string;
  prefix: string;
  /** Resolution mode — either DPI ({ dpi: 600 }) or longest-side pixels ({ scaleTo: 2000 }). */
  mode: { dpi: number } | { scaleTo: number };
  jpegQuality?: number;
}

/**
 * Render every page of a PDF to JPEGs via pdftoppm. Returns the produced
 * file paths in page order. Files are named `<prefix>-<NN>.jpg`.
 */
export async function renderPdfPages(opts: RenderPdfOptions): Promise<string[]> {
  await fs.mkdir(opts.outDir, { recursive: true });
  const args = ["-jpeg"];
  const quality = opts.jpegQuality ?? 88;
  args.push("-jpegopt", `quality=${quality}`);
  if ("dpi" in opts.mode) {
    args.push("-r", String(opts.mode.dpi));
  } else {
    args.push("-scale-to", String(opts.mode.scaleTo));
  }
  args.push(opts.pdfPath, path.join(opts.outDir, opts.prefix));
  await runProcess("pdftoppm", args);

  const entries = await fs.readdir(opts.outDir);
  const matched = entries
    .filter((name) => name.startsWith(`${opts.prefix}-`) && name.endsWith(".jpg"))
    .toSorted();
  return matched.map((name) => path.join(opts.outDir, name));
}

/**
 * Per-page output from the scan-mode analyzer. The model classifies each
 * page and (when applicable) names a partner page within the same batch.
 *
 * `index` is the GLOBAL page index in the PDF after we translate from the
 * model's batch-relative indices.
 */
export interface ScanPageAnalysis {
  index: number;
  kind: "photo" | "back" | "blank" | "unsure";
  /** Global page index of the partner, or null. */
  paired_with_index: number | null;
  description: string;
  title: string;
  rotation: number;
  subject_bbox: number[] | null;
  has_text: boolean;
  text_blocks: Array<{ source: string; text: string }>;
  /** Date hint extracted from a back, in document form (e.g. "May 1985"). */
  date_hint: string | null;
  /** True when the model has low confidence in classification or transcription. */
  flag_for_review: boolean;
  flag_reason: string | null;
}

interface RawScanAnalysis {
  index: number;
  kind: "photo" | "back" | "blank" | "unsure";
  paired_with_index: number | null;
  description: string;
  title: string;
  rotation: number;
  subject_bbox: number[] | null;
  has_text: boolean;
  text_blocks: Array<{ source: string; text: string }>;
  date_hint: string | null;
  flag_for_review: boolean;
  flag_reason: string | null;
}

const SCAN_PROMPT = `You are analyzing pages from a single PDF that was produced by scanning a stack of physical photographs. Each photo's front (the picture) and back (often handwriting: a name, date, or short description; sometimes blank) appear as consecutive pages. Most often the front is first and the back is second, but occasionally the user fed the back in first.

The pages you see are numbered 0..N-1 in the order they appear in this batch. Your job, for each page, is to:

1. Classify the page as one of:
   - "photo": a photograph of a scene, person, object, etc.
   - "back": the back of a photo — typically blank paper or paper with handwriting (a name, date, location). Backs of photos do NOT show pictures.
   - "blank": an entirely blank page with no markings worth keeping.
   - "unsure": you can't confidently classify it.

2. For "photo" and "back" pages, identify the partner page by index within this batch using paired_with_index. A pair is one "photo" page next to one "back" page that describes it. Pairs are usually adjacent (i+1 or i-1), but use your judgment based on visual cues — handwriting referring to the photo's content, a date that fits the photo's apparent era, etc. If a photo has no back in this batch, set paired_with_index to null. If a back has no matching photo in this batch, set paired_with_index to null.

3. For PHOTO pages, fill:
   - description: one sentence describing what's in the photo (subjects, setting, era cues if visible).
   - title: a short filename-friendly title (2-4 words, underscores, retain capitals, e.g., "Beach_Vacation" or "Grandma_Birthday").
   - rotation: degrees clockwise the image needs to be rotated to view correctly — 0, 90, 180, 270. Judge by face orientation, sky/ground, text within the scene. Use 0 if uncertain.
   - subject_bbox: bounding box of the actual photo within the scanned page as [y1, x1, y2, x2] on a 0-1000 scale. The scanner typically captures whitespace around the photo; identify the photo's edges. null if the photo fills the page or you cannot tell.
   - has_text: true only if the photograph itself contains meaningful text (a sign in the scene, a banner, etc.) — NOT for handwriting on the back.
   - text_blocks: any meaningful text visible IN the photograph (signs, banners). Empty if none.

4. For BACK pages, fill:
   - description: empty string — backs don't get descriptions of their own.
   - title: empty string.
   - rotation: 0 (backs are read by the human; we don't rotate them).
   - subject_bbox: null.
   - has_text: true if there's handwriting or printing.
   - text_blocks: transcribe handwriting/printing exactly as written. Use source: "back" for each block. Preserve line breaks. Leave empty if the back is essentially blank.
   - date_hint: if the back contains a date that appears to refer to when the photo was taken, capture it as it appears (e.g. "May 1985", "8/14/72", "Christmas '63"). null otherwise.

5. For BLANK pages: leave all text fields empty, paired_with_index null, kind "blank".

6. flag_for_review: true when something is uncertain — handwriting that's hard to read, a back that might also be a photo, ambiguous pairing, unclear orientation. flag_reason: a short human-readable note explaining what to check. Set false / null when confident.

Important: paired_with_index is the index WITHIN THIS BATCH (0..N-1), not a global PDF page number. If the partner is not present in this batch, set it to null even if you suspect the partner exists elsewhere.`;

const SCAN_RESPONSE_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      index: { type: "INTEGER" },
      kind: { type: "STRING", enum: ["photo", "back", "blank", "unsure"] },
      paired_with_index: { type: "INTEGER", nullable: true },
      description: { type: "STRING" },
      title: { type: "STRING" },
      rotation: { type: "INTEGER" },
      subject_bbox: { type: "ARRAY", items: { type: "INTEGER" }, nullable: true },
      has_text: { type: "BOOLEAN" },
      text_blocks: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: { source: { type: "STRING" }, text: { type: "STRING" } },
          required: ["source", "text"],
        },
      },
      date_hint: { type: "STRING", nullable: true },
      flag_for_review: { type: "BOOLEAN" },
      flag_reason: { type: "STRING", nullable: true },
    },
    required: [
      "index",
      "kind",
      "paired_with_index",
      "description",
      "title",
      "rotation",
      "subject_bbox",
      "has_text",
      "text_blocks",
      "date_hint",
      "flag_for_review",
      "flag_reason",
    ],
  },
} as const;

export interface BatchUsage {
  prompt: number;
  output: number;
  thinking: number;
}

/**
 * Build the full Gemini prompt, optionally prefixed with boxholder-supplied
 * context (names of recurring people, eras, places, etc.). The context block
 * is wrapped with explicit guardrails so the model uses it for
 * disambiguation rather than inventing identifications.
 */
export function buildScanPrompt(boxholderContext: string | null): string {
  if (!boxholderContext || boxholderContext.trim().length === 0) {
    return SCAN_PROMPT;
  }
  const contextSection = `# Context from the boxholder

The following notes were provided by the person whose photos these are. Use them to:
- Disambiguate handwriting (a name on the back that fits a person mentioned here is more likely correct)
- Interpret eras, places, and relationships referenced in handwriting or visible in photos
- Write more meaningful descriptions when you can plausibly tie what you see to the notes

DO NOT invent identifications without strong visual or textual evidence. If you're not confident, prefer generic descriptions ("a young woman") or hedged ones ("possibly Noor, based on era and back caption") over confident misidentification.

---

${boxholderContext.trim()}

---

`;
  return contextSection + SCAN_PROMPT;
}

/**
 * Analyze a batch of consecutive scanned pages with Gemini Flash. Returns
 * analyses with batch-relative indices (0..N-1); the caller translates to
 * global indices.
 */
export async function analyzeScanBatchWithGemini(
  apiKey: string,
  {
    imagePaths,
    thinkingBudget,
    boxholderContext,
  }: { imagePaths: string[]; thinkingBudget?: number; boxholderContext?: string | null }
): Promise<{ analyses: RawScanAnalysis[]; usage: BatchUsage | null }> {
  const ai = new GoogleGenAI({ apiKey });

  const imageParts = [];
  for (const imgPath of imagePaths) {
    const imgData = await fs.readFile(imgPath);
    imageParts.push({
      inlineData: {
        mimeType: getMimeType(imgPath),
        data: imgData.toString("base64"),
      },
    });
  }

  const prompt = buildScanPrompt(boxholderContext ?? null);
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }, ...imageParts] }],
    config: {
      thinkingConfig: { thinkingBudget: thinkingBudget ?? 2048 },
      responseMimeType: "application/json",
      responseSchema: SCAN_RESPONSE_SCHEMA,
    },
  });

  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
  const usageMeta = response.usageMetadata;
  if (!text) {
    throw new GeminiEmptyResponseError({
      finishReason: response.candidates?.[0]?.finishReason,
      finishMessage: response.candidates?.[0]?.finishMessage,
      blockReason: response.promptFeedback?.blockReason,
      blockReasonMessage: response.promptFeedback?.blockReasonMessage,
      promptTokens: usageMeta?.promptTokenCount,
      candidatesTokens: usageMeta?.candidatesTokenCount,
      thoughtsTokens: usageMeta?.thoughtsTokenCount,
      totalTokens: usageMeta?.totalTokenCount,
      imageCount: imagePaths.length,
    });
  }

  const analyses: RawScanAnalysis[] = JSON.parse(text);
  const usage: BatchUsage | null = usageMeta
    ? {
        prompt: usageMeta.promptTokenCount || 0,
        output: usageMeta.candidatesTokenCount || 0,
        thinking: usageMeta.thoughtsTokenCount || 0,
      }
    : null;
  return { analyses, usage };
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
  if (batchSize < 2) throw new Error("batchSize must be >= 2");
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
    if (outcome.usage) {
      if (!totalUsage) {
        totalUsage = { ...outcome.usage };
      } else {
        totalUsage.prompt += outcome.usage.prompt;
        totalUsage.output += outcome.usage.output;
        totalUsage.thinking += outcome.usage.thinking;
      }
    }
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOneBatch(args: {
  apiKey: string;
  plan: ScanBatchPlan;
  imagePaths: string[];
  log: (line: string) => void;
  thinkingBudget?: number;
  boxholderContext?: string | null;
}): Promise<OneBatchOutcome> {
  const { apiKey, plan, imagePaths, log } = args;
  const batchPaths = plan.globalIndices.map((g) => imagePaths[g]!);

  // Transient-error retry: try the same batch up to 3 times with exponential
  // backoff before giving up or splitting.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await analyzeScanBatchWithGemini(apiKey, {
        imagePaths: batchPaths,
        boxholderContext: args.boxholderContext ?? null,
        ...(args.thinkingBudget !== undefined ? { thinkingBudget: args.thinkingBudget } : {}),
      });
      const translated: ScanPageAnalysis[] = [];
      let dropped = 0;
      for (const raw of result.analyses) {
        const t = translateIndices(raw, plan.globalIndices);
        if (t === null) {
          dropped++;
          continue;
        }
        translated.push(t);
      }
      if (dropped > 0) {
        log(`  Warning: dropped ${dropped} analysis entries with out-of-range indices`);
      }
      return { analyses: translated, usage: result.usage, failed: 0 };
    } catch (err) {
      lastErr = err;
      if (!isTransientGeminiError(err)) break;
      const waitMs = 2000 * 2 ** attempt;
      log(`  Transient error, retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/3)...`);
      await sleep(waitMs);
    }
  }

  // Either non-transient failure or 3 transient retries exhausted.
  {
    const err = lastErr;
    const reason = (err as Error).message;
    log(`  Error: ${reason}`);
    const retryable =
      err instanceof GeminiEmptyResponseError &&
      (err.finishReason === "RECITATION" || err.finishReason === "MAX_TOKENS");
    if (!retryable) {
      return { analyses: [], usage: null, failed: plan.globalIndices.length };
    }
    if (plan.globalIndices.length === 1) {
      log("  Retrying singleton with thinking disabled...");
      try {
        const result = await analyzeScanBatchWithGemini(apiKey, {
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
    const mid = Math.ceil(plan.globalIndices.length / 2);
    log(`  Splitting into ${mid} + ${plan.globalIndices.length - mid}`);
    const leftPlan: ScanBatchPlan = { globalIndices: plan.globalIndices.slice(0, mid) };
    const rightPlan: ScanBatchPlan = { globalIndices: plan.globalIndices.slice(mid) };
    const left = await runOneBatch({ ...args, plan: leftPlan });
    const right = await runOneBatch({ ...args, plan: rightPlan });
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

export interface ResolvedPage {
  index: number;
  analysis: ScanPageAnalysis;
  /** Final partner page index after pair reconciliation, or null. */
  pairedWith: number | null;
  /** Multiple analyses existed and disagreed on something. Worth flagging. */
  conflict: boolean;
}

/**
 * Reconcile per-page analyses across overlapping batches and resolve final
 * pair assignments.
 *
 * For each page:
 *  - If it appeared in only one batch, that analysis wins.
 *  - If it appeared in two, prefer the analysis that named a partner; if
 *    both did, prefer the one whose claim is mutual with the partner's
 *    other-batch claim.
 *
 * For pairing: only finalize a pair when both pages name each other (mutual
 * agreement). Otherwise the pages stay singletons / orphans.
 */
export function resolveScanPages(
  pageAnalyses: Map<number, ScanPageAnalysis[]>,
  totalPages: number
): ResolvedPage[] {
  const picked: ScanPageAnalysis[] = Array.from({ length: totalPages });
  const conflicts: boolean[] = Array.from({ length: totalPages }, () => false);

  for (let i = 0; i < totalPages; i++) {
    const analyses = pageAnalyses.get(i);
    if (!analyses || analyses.length === 0) {
      picked[i] = makeMissingAnalysis(i);
      continue;
    }
    if (analyses.length === 1) {
      picked[i] = analyses[0]!;
      continue;
    }
    const a = analyses[0]!;
    const b = analyses[1]!;
    if (a.kind !== b.kind || a.paired_with_index !== b.paired_with_index) {
      conflicts[i] = true;
    }
    // Prefer the analysis that named a partner.
    if (a.paired_with_index !== null && b.paired_with_index === null) {
      picked[i] = a;
    } else if (b.paired_with_index !== null && a.paired_with_index === null) {
      picked[i] = b;
    } else {
      // Both named (or both null) — take the second batch, which saw a wider
      // forward context. Arbitrary but consistent.
      picked[i] = b;
    }
  }

  // Reconcile pairs: only mutual claims survive.
  const resolved: ResolvedPage[] = [];
  for (let i = 0; i < totalPages; i++) {
    const analysis = picked[i]!;
    let pairedWith: number | null = null;
    const claim = analysis.paired_with_index;
    if (claim !== null && claim >= 0 && claim < totalPages) {
      const partner = picked[claim];
      if (partner && partner.paired_with_index === i) {
        pairedWith = claim;
      } else {
        // Partner didn't reciprocate — treat as orphan, flag for conflict.
        conflicts[i] = true;
      }
    }
    resolved.push({ index: i, analysis, pairedWith, conflict: conflicts[i]! });
  }
  return resolved;
}

function makeMissingAnalysis(index: number): ScanPageAnalysis {
  return {
    index,
    kind: "unsure",
    paired_with_index: null,
    description: "",
    title: "",
    rotation: 0,
    subject_bbox: null,
    has_text: false,
    text_blocks: [],
    date_hint: null,
    flag_for_review: true,
    flag_reason: "Page analysis missing — Gemini batch failed",
  };
}

export interface PhotoBundle {
  photoIndex: number;
  backIndex: number | null;
  photo: ScanPageAnalysis;
  back: ScanPageAnalysis | null;
  flagForReview: boolean;
  flagReasons: string[];
}

export interface OrphanBack {
  index: number;
  analysis: ScanPageAnalysis;
}

export interface BundleResult {
  bundles: PhotoBundle[];
  orphanBacks: OrphanBack[];
  unsurePages: ResolvedPage[];
  blankPages: number[];
}

/**
 * Group resolved pages into photo bundles (photo + optional back), orphan
 * backs (text-bearing pages with no matching photo), unsure pages (need
 * human review), and blank pages (drop).
 */
export function bundleResolvedPages(resolved: ResolvedPage[]): BundleResult {
  const used = new Set<number>();
  const bundles: PhotoBundle[] = [];
  const orphanBacks: OrphanBack[] = [];
  const unsurePages: ResolvedPage[] = [];
  const blankPages: number[] = [];

  for (const page of resolved) {
    if (used.has(page.index)) continue;
    const a = page.analysis;
    if (a.kind === "blank") {
      used.add(page.index);
      blankPages.push(page.index);
      continue;
    }
    if (a.kind === "unsure") {
      used.add(page.index);
      unsurePages.push(page);
      continue;
    }
    if (a.kind === "photo") {
      used.add(page.index);
      const flagReasons: string[] = [];
      if (a.flag_for_review && a.flag_reason) flagReasons.push(a.flag_reason);
      if (page.conflict) flagReasons.push("Overlapping batches disagreed on this page");
      let back: ScanPageAnalysis | null = null;
      let backIndex: number | null = null;
      if (page.pairedWith !== null) {
        const partner = resolved[page.pairedWith];
        if (partner && partner.analysis.kind === "back" && !used.has(partner.index)) {
          back = partner.analysis;
          backIndex = partner.index;
          used.add(partner.index);
          if (partner.analysis.flag_for_review && partner.analysis.flag_reason) {
            flagReasons.push(`Back: ${partner.analysis.flag_reason}`);
          }
          if (partner.conflict) flagReasons.push("Overlapping batches disagreed on the back");
        }
      }
      bundles.push({
        photoIndex: page.index,
        backIndex,
        photo: a,
        back,
        flagForReview: flagReasons.length > 0,
        flagReasons,
      });
      continue;
    }
    if (a.kind === "back") {
      // A back not consumed by any photo — orphan.
      used.add(page.index);
      orphanBacks.push({ index: page.index, analysis: a });
      continue;
    }
  }

  return { bundles, orphanBacks, unsurePages, blankPages };
}
