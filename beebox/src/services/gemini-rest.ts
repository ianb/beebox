/**
 * Gemini `generateContent` over REST, for the callers that send inline images
 * or audio and read text or an image back. Replaces the `@google/genai` SDK
 * (`issues/closed/decisions/2026-10-27-replace-google-genai-with-a-rest-helper.md`);
 * `services/tts.ts` calls the same API host the same way.
 *
 * No retry and no timeout unless the caller passes one: the SDK did neither by
 * default for these calls, and ky's own defaults (a 10 s timeout, retried GETs)
 * would change that. A non-2xx answer is `GeminiHttpError`.
 */

import ky, { HTTPError } from "ky";
import { z } from "zod";

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/** One piece of a user turn: text, or bytes (base64) with their MIME type. */
export type GeminiRequestPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

/** The generation settings the callers use; REST field names. */
export interface GeminiGenerationConfig {
  responseMimeType?: string;
  /** Gemini's schema dialect (upper-case type names), passed through as-is. */
  responseSchema?: unknown;
  responseModalities?: Array<"TEXT" | "IMAGE">;
  thinkingConfig?: { thinkingBudget: number };
}

/** The response fields callers read; anything else the API sends is dropped. */
const geminiResponseSchema = z.object({
  candidates: z.array(z.object({
    content: z.object({
      parts: z.array(z.object({
        text: z.string().optional(),
        inlineData: z.object({ mimeType: z.string().optional(), data: z.string().optional() }).nullish(),
      })).nullish(),
    }).nullish(),
    finishReason: z.string().optional(),
    finishMessage: z.string().optional(),
  })).nullish(),
  promptFeedback: z.object({
    blockReason: z.string().optional(),
    blockReasonMessage: z.string().optional(),
  }).nullish(),
  usageMetadata: z.object({
    promptTokenCount: z.number().optional(),
    candidatesTokenCount: z.number().optional(),
    thoughtsTokenCount: z.number().optional(),
    totalTokenCount: z.number().optional(),
  }).nullish(),
});
export type GeminiResponse = z.infer<typeof geminiResponseSchema>;

/** The API's error envelope: `{ "error": { "code", "message", "status" } }`. */
const geminiErrorBodySchema = z.object({ error: z.object({ message: z.string() }) });

/** Gemini answered with a non-2xx status. `apiMessage` is the API's own explanation when it sent one. */
export class GeminiHttpError extends Error {
  readonly status: number;
  readonly apiMessage: string | undefined;
  constructor({ status, apiMessage }: { status: number; apiMessage: string | undefined }, options?: ErrorOptions) {
    super(`Gemini API error ${String(status)}${apiMessage === undefined ? "" : `: ${apiMessage}`}`, options);
    this.name = "GeminiHttpError";
    this.status = status;
    this.apiMessage = apiMessage;
  }
}

/** Gemini answered 2xx with a body that is not the documented response shape. */
export class GeminiResponseShapeError extends Error {
  constructor(cause: z.ZodError) {
    super(`Gemini API returned an unexpected response shape: ${cause.message}`, { cause });
    this.name = "GeminiResponseShapeError";
  }
}

async function apiMessageOf(error: HTTPError): Promise<string | undefined> {
  try {
    const parsed = geminiErrorBodySchema.safeParse(await error.response.clone().json());
    return parsed.success ? parsed.data.error.message : undefined;
  } catch (e) {
    // The body was not JSON (a proxy's error page); the status stands alone.
    console.debug("[gemini] error body was not JSON:", e);
    return undefined;
  }
}

/** One `generateContent` call as a single user turn. */
export async function generateContent({ apiKey, model, parts, generationConfig, signal, timeoutMs }: {
  apiKey: string;
  model: string;
  parts: GeminiRequestPart[];
  generationConfig?: GeminiGenerationConfig;
  signal?: AbortSignal;
  /** Whole-request budget; none by default. */
  timeoutMs?: number;
}): Promise<GeminiResponse> {
  let body: unknown;
  try {
    body = await ky
      .post(`models/${encodeURIComponent(model)}:generateContent`, {
        prefixUrl: GEMINI_API_BASE_URL,
        headers: { "x-goog-api-key": apiKey },
        retry: 0,
        timeout: timeoutMs ?? false,
        ...(signal !== undefined && { signal }),
        json: {
          contents: [{ role: "user", parts }],
          ...(generationConfig !== undefined && { generationConfig }),
        },
      })
      .json<unknown>();
  } catch (e) {
    if (e instanceof HTTPError) {
      throw new GeminiHttpError({ status: e.response.status, apiMessage: await apiMessageOf(e) }, { cause: e });
    }
    throw e;
  }
  const parsed = geminiResponseSchema.safeParse(body);
  if (!parsed.success) throw new GeminiResponseShapeError(parsed.error);
  return parsed.data;
}
