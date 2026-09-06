/**
 * The scan-import vision pass over OpenRouter — the same Gemini Flash model,
 * the same prompt, and the same validated result shape as
 * `scan-import-gemini.ts`, reached through the aggregator when the box has no
 * `gemini` key of its own (`core/openrouter.ts` decides which).
 *
 * Two things differ, and neither is a choice:
 *
 * - **The schema dialect.** Gemini takes its own uppercase `responseSchema`;
 *   OpenRouter speaks OpenAI's `response_format: json_schema`. Rather than
 *   hand-maintain the field list a third time, this arm DERIVES the JSON Schema
 *   from `rawScanAnalysisSchema` — the same Zod object that validates the
 *   response afterwards — so the request and the check cannot drift apart.
 * - **The root type.** OpenAI's structured-output shape wants an object at the
 *   root, not the bare array Gemini returns, so the batch travels wrapped in
 *   `{ analyses: [...] }` and is unwrapped before the shared parser sees it.
 *
 * The model's answer is validated by `parseGeminiJsonArray` and
 * `assertBatchAlignment` exactly as the direct arm's is. A schema attached to a
 * request is a hint; the check on the way back is what makes a misaligned batch
 * fail instead of silently misattaching every later page.
 */

import { promises as fs } from "node:fs";
import ky from "ky";
import { z } from "zod";
import { isRecord } from "../../lib/is-record.js";
import { OPENROUTER_BASE_URL, openRouterProvider } from "../openrouter.js";
import { getMimeType, GeminiEmptyResponseError, parseGeminiJsonArray } from "./describe-images-helpers.js";
import {
  assertBatchAlignment,
  buildScanPrompt,
  rawScanAnalysisSchema,
  type BatchUsage,
  type RawScanAnalysis,
} from "./scan-import-gemini.js";

/** The same `gemini-2.5-flash` the direct arm uses, under OpenRouter's naming. */
const OPENROUTER_SCAN_MODEL = "google/gemini-2.5-flash";

/** The batch wrapper OpenAI-shaped structured output requires at the root. */
const scanBatchSchema = z.object({ analyses: z.array(rawScanAnalysisSchema) });

export async function analyzeScanBatchWithOpenRouter(
  apiKey: string,
  {
    imagePaths,
    thinkingBudget,
    boxholderContext,
  }: { imagePaths: string[]; thinkingBudget?: number; boxholderContext?: string | null },
): Promise<{ analyses: RawScanAnalysis[]; usage: BatchUsage | null }> {
  const imageParts = [];
  for (const imgPath of imagePaths) {
    const imgData = await fs.readFile(imgPath);
    // OpenAI's image part takes a data URI, where Gemini takes the MIME type
    // and the base64 as separate fields.
    imageParts.push({
      type: "image_url" as const,
      image_url: { url: `data:${getMimeType(imgPath)};base64,${imgData.toString("base64")}` },
    });
  }

  const body = await ky
    .post("chat/completions", {
      prefixUrl: OPENROUTER_BASE_URL,
      headers: { Authorization: `Bearer ${apiKey}` },
      // A scan batch is many full-resolution pages; the direct arm inherits the
      // SDK's own generous default, so this one says the same thing out loud.
      timeout: 300_000,
      json: {
        model: OPENROUTER_SCAN_MODEL,
        provider: openRouterProvider("google-ai-studio"),
        reasoning: { max_tokens: thinkingBudget ?? 2048 },
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "scan_batch",
            schema: z.toJSONSchema(scanBatchSchema, { target: "draft-7" }),
          },
        },
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: buildScanPrompt(boxholderContext ?? null) }, ...imageParts],
          },
        ],
      },
    })
    .json<unknown>();

  const choice = isRecord(body) && Array.isArray(body["choices"]) ? body["choices"][0] : undefined;
  const message = isRecord(choice) ? choice["message"] : undefined;
  const text = isRecord(message) && typeof message["content"] === "string" ? message["content"] : "";
  const usageMeta = isRecord(body) && isRecord(body["usage"]) ? body["usage"] : undefined;
  if (!text) {
    throw new GeminiEmptyResponseError({
      finishReason: isRecord(choice) && typeof choice["finish_reason"] === "string" ? choice["finish_reason"] : undefined,
      // OpenRouter's chat response has no counterpart for Gemini's block
      // reasons or its separate thinking-token count.
      finishMessage: undefined,
      blockReason: undefined,
      blockReasonMessage: undefined,
      promptTokens: numberField(usageMeta, "prompt_tokens"),
      candidatesTokens: numberField(usageMeta, "completion_tokens"),
      thoughtsTokens: usageMeta === undefined ? undefined : reasoningTokens(usageMeta),
      totalTokens: numberField(usageMeta, "total_tokens"),
      imageCount: imagePaths.length,
    });
  }

  // The wrapper is unwrapped before the shared parser runs, so both arms hand
  // it the same bare array and get the same errors on a malformed batch.
  const analyses = parseGeminiJsonArray(unwrapAnalyses(text), { itemSchema: rawScanAnalysisSchema });
  assertBatchAlignment(analyses, imagePaths.length);
  const usage: BatchUsage | null =
    usageMeta === undefined
      ? null
      : {
          prompt: numberField(usageMeta, "prompt_tokens") ?? 0,
          output: numberField(usageMeta, "completion_tokens") ?? 0,
          // OpenRouter reports reasoning tokens in a nested details object when
          // the provider breaks them out; absent means none were charged.
          thinking: reasoningTokens(usageMeta),
        };
  return { analyses, usage };
}

/**
 * Strip the `{ "analyses": [...] }` wrapper back off, leaving the JSON text the
 * shared parser expects. A response that does not have the wrapper is passed
 * through untouched rather than rejected here — `parseGeminiJsonArray` already
 * owns "this is not the array we asked for", and it says so better.
 */
function unwrapAnalyses(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (_e) {
    /* ignore: not JSON at all is the shared parser's error to report, with its own context */
    return text;
  }
  const wrapped = scanBatchSchema.safeParse(parsed);
  return wrapped.success ? JSON.stringify(wrapped.data.analyses) : text;
}

function numberField(usage: Record<string, unknown> | undefined, name: string): number | undefined {
  const value = usage?.[name];
  return typeof value === "number" ? value : undefined;
}

function reasoningTokens(usage: Record<string, unknown>): number {
  const details = usage["completion_tokens_details"];
  return isRecord(details) ? (numberField(details, "reasoning_tokens") ?? 0) : 0;
}
