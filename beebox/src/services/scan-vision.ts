/**
 * ScanVision — the photo-analysis backend behind `bbx scan-import`'s photo
 * flow, as a service interface with two real implementations and a fake.
 *
 * The default backend is Claude Sonnet via the Claude Agent SDK
 * (`scan-vision-claude.ts`) — zero extra setup beyond the Claude auth the
 * reactor already requires. Gemini Flash stays available as an opt-in
 * (`BBX_SCAN_VISION=gemini`) for deployments that hold a key that reaches it —
 * a granted `gemini` secret, or an `openrouter` one standing in for it
 * (`core/openrouter.ts`). It wraps the engines in `scan-import-gemini.ts` and
 * `scan-import-openrouter.ts` unchanged.
 * Design + measured evidence: `docs/plans/scan-vision-claude.md`.
 *
 * Both implementations enforce the batch-alignment post-condition
 * (`assertBatchAlignment`) before returning, so a schema-valid-but-wrong
 * response can never misattach analyses to the wrong pages downstream.
 */

import { HTTPError } from "ky";
import {
  analyzeScanBatchWithGemini,
  ScanBatchMisalignedError,
  type BatchUsage,
  type RawScanAnalysis,
} from "../core/commands/scan-import-gemini.js";
import { analyzeScanBatchWithOpenRouter } from "../core/commands/scan-import-openrouter.js";
import { GeminiEmptyResponseError } from "../core/commands/describe-images-helpers.js";
import { isAuthRejection } from "../core/secrets/probe-registry.js";
import type { ModelRoute } from "../core/openrouter.js";
import { err, ok, type Result } from "../lib/result.js";
import { errorMessage } from "../lib/error-guards.js";

export interface ScanVisionAnalyzeArgs {
  imagePaths: string[];
  boxholderContext: string | null;
  /** Last-resort retry of a single page. Gemini disables thinking; Claude
   *  re-runs unchanged (a fresh sample is the only lever left). */
  lastResort?: boolean | undefined;
}

export interface ScanVisionResult {
  /** Batch-relative analyses, exactly one per input page (post-conditioned). */
  analyses: RawScanAnalysis[];
  usage: BatchUsage | null;
  /** Dollars, when the backend reports it (Claude does; Gemini doesn't). */
  costUsd: number | null;
}

/**
 * How the batch runner should react to a failed `analyzeBatch` call:
 * - `transient` — backoff and re-attempt the same batch (capacity/rate blip);
 * - `split` — re-run as smaller overlapping batches (content-shaped failure);
 * - `batch` — give up on this batch; its pages become flagged placeholders;
 * - `fatal` — the provider/config is broken, not the page: abort the run.
 */
export type ScanVisionRetry = "transient" | "split" | "batch" | "fatal";

/**
 * Thrown by `analyzeBatch`. Carries the failed attempt's usage/cost so the
 * runner's accounting includes retried and failed calls, not just successes.
 */
export class ScanVisionBatchError extends Error {
  readonly retry: ScanVisionRetry;
  readonly usage: BatchUsage | null;
  readonly costUsd: number | null;

  constructor(
    message: string,
    {
      retry,
      usage,
      costUsd,
      cause,
    }: { retry: ScanVisionRetry; usage?: BatchUsage | null; costUsd?: number | null; cause?: unknown }
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ScanVisionBatchError";
    this.retry = retry;
    this.usage = usage ?? null;
    this.costUsd = costUsd ?? null;
  }
}

export interface ScanVisionService {
  readonly backend: "claude" | "gemini" | "fake";
  /** Pages per model call the batch planner should use (>= 2, so a photo and
   *  its back can be paired within one call). */
  readonly batchSize: number;
  analyzeBatch(args: ScanVisionAnalyzeArgs): Promise<ScanVisionResult>;
}

// ─── Backend selection ───────────────────────────────────────────────────────

export type ScanVisionSelection = { backend: "claude" } | { backend: "gemini"; route: ModelRoute };

/**
 * Resolve which backend `bbx scan-import` should use. `env` selects the backend;
 * `route` is the ALREADY-RESOLVED credential and path from `core/openrouter.ts`
 * — the box's own Gemini key (`core/gemini-key.ts`, the machine secret store)
 * when it has one, OpenRouter otherwise. This function never reads a credential
 * out of the environment itself, so there is exactly one place a Gemini key is
 * resolved (`docs/implemented-plans/secret-custody.md`).
 *
 * The `gemini` backend name stays the backend's name because it names the
 * MODEL, which is the same either way; `route.via` says how it is reached.
 *
 * Fail-closed: an explicit `BBX_SCAN_VISION=gemini` with no route at all is an
 * error, never a silent fallback to Claude; so is an unknown value.
 */
export function selectScanVisionBackend(
  env: NodeJS.ProcessEnv,
  route: ModelRoute | null,
): Result<ScanVisionSelection> {
  // TODO(env-migration): long-tail feature-gate var, direct read per src/lib/env.ts.
  const selected = env["BBX_SCAN_VISION"] ?? "claude";
  if (selected === "claude") return ok({ backend: "claude" });
  if (selected === "gemini") {
    if (route === null || route.apiKey === "") {
      return err(
    'BBX_SCAN_VISION=gemini but no key can reach the model — grant the "gemini" or "openrouter" secret to this box',
      );
    }
    return ok({ backend: "gemini", route });
  }
  return err(`BBX_SCAN_VISION=${selected} is not a valid backend (valid: claude, gemini)`);
}

// ─── Gemini backend ──────────────────────────────────────────────────────────

/**
 * Transient Gemini errors that warrant a backoff-and-retry on the same batch:
 * UNAVAILABLE/503 capacity spikes and RESOURCE_EXHAUSTED/429 throttling.
 */
function isTransientGeminiError(e: Error): boolean {
  const msg = e.message;
  return (
    msg.includes('"code":503') ||
    msg.includes('"code":429') ||
    msg.includes("UNAVAILABLE") ||
    msg.includes("RESOURCE_EXHAUSTED")
  );
}

/** A broken credential fails the whole run once, loudly — not once per batch. */
function isFatalGeminiError(e: Error): boolean {
  const msg = e.message;
  return (
    msg.includes('"code":401') ||
    msg.includes('"code":403') ||
    msg.includes("API_KEY_INVALID") ||
    msg.includes("PERMISSION_DENIED")
  );
}

/**
 * The OpenRouter arm fails with an HTTP status rather than Gemini's embedded
 * `"code":NNN` prose, so the status is read off the thrown response first and
 * the string matching below stays the direct arm's business. Same three
 * verdicts, same meanings — a 429/503 is worth another try, a 401/403 is not.
 */
function classifyHttpStatus(status: number): ScanVisionRetry | null {
  if (status === 429 || status === 503) return "transient";
  if (isAuthRejection(status)) return "fatal";
  return null;
}

function classifyGeminiError(e: unknown): ScanVisionRetry {
  if (!(e instanceof Error)) return "batch";
  if (e instanceof HTTPError) {
    const verdict = classifyHttpStatus(e.response.status);
    if (verdict !== null) return verdict;
  }
  if (isTransientGeminiError(e)) return "transient";
  if (isFatalGeminiError(e)) return "fatal";
  if (
    e instanceof GeminiEmptyResponseError &&
    (e.finishReason === "RECITATION" || e.finishReason === "MAX_TOKENS")
  ) {
    return "split";
  }
  if (e instanceof ScanBatchMisalignedError) return "split";
  return "batch";
}

export function createGeminiScanVision({ route }: { route: ModelRoute }): ScanVisionService {
  const analyze = route.via === "openrouter" ? analyzeScanBatchWithOpenRouter : analyzeScanBatchWithGemini;
  return {
    backend: "gemini",
    batchSize: 8,
    async analyzeBatch(args): Promise<ScanVisionResult> {
      try {
        const result = await analyze(route.apiKey, {
          imagePaths: args.imagePaths,
          boxholderContext: args.boxholderContext,
          // Last-ditch singleton retry runs with thinking disabled — the
          // historical RECITATION/MAX_TOKENS escape hatch.
          ...(args.lastResort ? { thinkingBudget: 0 } : {}),
        });
        return { analyses: result.analyses, usage: result.usage, costUsd: null };
      } catch (e) {
        throw new ScanVisionBatchError(errorMessage(e), { retry: classifyGeminiError(e), cause: e });
      }
    },
  };
}

// ─── Fake ────────────────────────────────────────────────────────────────────

/** A plausible default page: even pages are photos paired with the following
 *  back; odd pages are backs paired with the preceding photo. */
function fakeAnalysis(index: number, imageCount: number): RawScanAnalysis {
  const isPhoto = index % 2 === 0;
  const partner = isPhoto ? (index + 1 < imageCount ? index + 1 : null) : index - 1;
  return {
    index,
    kind: isPhoto ? "photo" : "back",
    paired_with_index: partner,
    description: isPhoto ? `Fake photo ${index}` : "",
    title: isPhoto ? `Fake_Photo_${index}` : "",
    rotation: 0,
    subject_bbox: null,
    has_text: !isPhoto,
    text_blocks: isPhoto ? [] : [{ source: "back", text: `Fake back caption ${index}` }],
    date_hint: null,
    flag_for_review: false,
    flag_reason: null,
  };
}

/** The failure the fake injects when scripted to fail. */
export class FakeScanVisionFailureError extends ScanVisionBatchError {
  constructor({ retry, usage }: { retry: ScanVisionRetry; usage: BatchUsage }) {
    super("fake scan-vision failure (scripted)", { retry, usage, costUsd: 0.01 });
    this.name = "FakeScanVisionFailureError";
  }
}

export interface FakeScanVisionOptions {
  /** Replace whole analyses per call: given the batch's paths, return the
   *  batch-relative analyses. Defaults to the photo/back alternation above. */
  analyze?: (imagePaths: string[]) => RawScanAnalysis[];
  /** Fail the first N calls with `failRetry` before succeeding. */
  failTimes?: number;
  /** Retry classification for injected failures. */
  failRetry?: ScanVisionRetry;
  /** When set, EVERY call fails with this classification. */
  alwaysFailRetry?: ScanVisionRetry;
}

export interface FakeScanVisionService extends ScanVisionService {
  calls: Array<{ imagePaths: string[]; boxholderContext: string | null; lastResort: boolean }>;
  describe(): string;
}

export function createFakeScanVision(options?: FakeScanVisionOptions): FakeScanVisionService {
  const opts = options ?? {};
  let failuresLeft = opts.failTimes ?? 0;
  const calls: FakeScanVisionService["calls"] = [];
  return {
    backend: "fake",
    batchSize: 3,
    calls,
    async analyzeBatch(args): Promise<ScanVisionResult> {
      calls.push({
        imagePaths: [...args.imagePaths],
        boxholderContext: args.boxholderContext,
        lastResort: args.lastResort ?? false,
      });
      const usage: BatchUsage = { prompt: 100 * args.imagePaths.length, output: 50, thinking: 0 };
      if (opts.alwaysFailRetry !== undefined) {
        throw new FakeScanVisionFailureError({ retry: opts.alwaysFailRetry, usage });
      }
      if (failuresLeft > 0) {
        failuresLeft--;
        throw new FakeScanVisionFailureError({ retry: opts.failRetry ?? "transient", usage });
      }
      const analyses = opts.analyze
        ? opts.analyze(args.imagePaths)
        : args.imagePaths.map((_, i) => fakeAnalysis(i, args.imagePaths.length));
      return { analyses, usage, costUsd: 0.05 };
    },
    describe(): string {
      const lines = [`scan-vision fake, ${calls.length} call(s)`];
      for (const call of calls) {
        const names = call.imagePaths.map((p) => p.split("/").at(-1)).join(", ");
        lines.push(
          `  [${names}] context=${call.boxholderContext === null ? "-" : "yes"}${call.lastResort ? " lastResort" : ""}`
        );
      }
      return lines.join("\n");
    },
  };
}
