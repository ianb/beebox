/**
 * OpenAI's transcription endpoint — the `whisper` HQ variants, as a sibling of
 * `voxtral.ts` and `deepgram.ts` rather than a passenger in the dispatcher.
 *
 * Three models share one endpoint and differ in what they will answer with:
 * classic `whisper-1` returns `verbose_json` with duration, language, and
 * optional word timing, while the LLM audio models return plain `json` and
 * nothing else. The route through OpenRouter for the same three models lives in
 * `openrouter.ts`; `index.ts` picks between them.
 */

import ky, { isHTTPError } from "ky";
import { z } from "zod";
import { buildMultipartForm, type MultipartPart } from "../../lib/multipart.js";
import { errorMessage } from "../../lib/error-guards.js";
import { getOpenAiThinkingKey } from "../openai-thinking-key.js";
import type {
  DetailedTranscriptionResult,
  TranscribeAudioParams,
  TranscriptionError,
  TranscriptionResult,
} from "./index.js";

const OPENAI_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";

class MissingWhisperKeyError extends Error implements TranscriptionError {
  readonly permanent = true;
  readonly code = "missing_api_key";
  constructor() {
    super(
      'No OpenAI key for transcription — ask the boxholder to grant the "openai-thinking" ' +
        "secret to this box",
    );
    this.name = "MissingWhisperKeyError";
  }
}

class WhisperNetworkError extends Error implements TranscriptionError {
  readonly permanent = false;
  readonly code = "network_error";
  constructor(cause: string) {
    super(`Network error: ${cause}`);
    this.name = "WhisperNetworkError";
  }
}

class WhisperApiError extends Error implements TranscriptionError {
  readonly permanent: boolean;
  readonly code: string;
  constructor(
    { status, statusText, details }: { status: number; statusText: string; details: string },
    meta: { permanent: boolean; code: string },
  ) {
    super(`Whisper API error: ${status} ${statusText} - ${details}`);
    this.name = "WhisperApiError";
    this.permanent = meta.permanent;
    this.code = meta.code;
  }
}

/**
 * Map our HQ service identifiers to OpenAI model names. The classic
 * Whisper model (`whisper-1`) returns verbose_json with duration/language
 * and supports word timestamps. The newer LLM-based audio models
 * (`gpt-4o-transcribe`, `gpt-4o-mini-transcribe`) only support
 * `response_format: "json"` and don't return timestamps — same endpoint,
 * different request shape.
 */
const OPENAI_WHISPER_MODELS = {
  whisper: "whisper-1",
  "whisper-llm": "gpt-4o-transcribe",
  "whisper-llm-mini": "gpt-4o-mini-transcribe",
} as const;
export type WhisperVariant = keyof typeof OPENAI_WHISPER_MODELS;
function isLlmWhisperVariant(variant: WhisperVariant): boolean {
  return variant === "whisper-llm" || variant === "whisper-llm-mini";
}

export async function transcribeAudioWhisper(
  params: TranscribeAudioParams,
  opts?: { variant: WhisperVariant },
): Promise<TranscriptionResult | DetailedTranscriptionResult> {
  opts = opts ?? { variant: "whisper" };
  const { audioBuffer, filename, prompt, options } = params;
  // The same `openai-thinking` resolver its siblings use (voxtral, deepgram):
  // the machine secret store first, then the env var. `boxRoot` is optional on
  // `TranscribeAudioParams`, and a caller that omits it gets the env path only
  // — there is no box to check grants for.
  const apiKey = await getOpenAiThinkingKey(params.boxRoot, { observe: true });
  if (!apiKey) {
    throw new MissingWhisperKeyError();
  }
  const model = OPENAI_WHISPER_MODELS[opts.variant];
  const isLlm = isLlmWhisperVariant(opts.variant);

  // Detect content type from extension
  const ext = filename.split(".").pop()?.toLowerCase();
  const contentType = getContentType(ext);

  // Build multipart form data
  const parts: MultipartPart[] = [
    {
      kind: "file",
      file: { name: "file", filename, contentType, data: audioBuffer },
    },
    { kind: "field", field: { name: "model", value: model } },
    // response_format field. LLM models only support `json`.
    {
      kind: "field",
      field: { name: "response_format", value: isLlm ? "json" : "verbose_json" },
    },
  ];

  // timestamp_granularities[] is whisper-1 only; the LLM models reject it.
  if (!isLlm && options?.wordTimestamps) {
    parts.push({ kind: "field", field: { name: "timestamp_granularities[]", value: "word" } });
  }

  // Add prompt if provided
  if (prompt) {
    parts.push({ kind: "field", field: { name: "prompt", value: prompt } });
  }

  const { body, boundary } = buildMultipartForm(parts);

  try {
    const result = await ky
      .post(OPENAI_ENDPOINT, {
        body,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        retry: 2,
        timeout: 120_000,
      })
      .json<{
        text: string;
        duration?: number;
        language?: string;
        words?: Array<{ word: string; start: number; end: number }>;
      }>();

    if (!isLlm && options?.wordTimestamps && result.words) {
      return {
        text: result.text,
        duration: result.duration ?? 0,
        language: result.language ?? "",
        words: result.words.map((w) => ({
          word: w.word,
          start: w.start,
          end: w.end,
        })),
      } satisfies DetailedTranscriptionResult;
    }

    return {
      text: result.text,
      duration: result.duration ?? 0,
      language: result.language ?? "",
    };
  } catch (error) {
    if (isTranscriptionError(error)) {
      throw error;
    }

    // ky HTTPError — parse the response for error details
    if (isHTTPError(error)) {
      throw await parseErrorResponse(error.response);
    }

    // Network or other errors are intermittent
    throw new WhisperNetworkError(errorMessage(error));
  }
}


const AUDIO_CONTENT_TYPES: Record<string, string> = {
  webm: "audio/webm",
  mp3: "audio/mpeg",
  m4a: "audio/m4a",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
};

function getContentType(ext: string | undefined): string {
  const contentType = ext === undefined ? undefined : AUDIO_CONTENT_TYPES[ext];
  return contentType ?? "audio/webm";
}

const whisperErrorBodySchema = z.object({
  error: z.object({ message: z.string().optional(), code: z.string().optional() }).optional(),
});

async function parseErrorResponse(response: Response): Promise<TranscriptionError> {
  let errorDetails: string;
  let errorCode: string | undefined;

  try {
    const raw: unknown = await response.json();
    const errorJson = whisperErrorBodySchema.safeParse(raw).data;
    errorDetails = errorJson?.error?.message ?? JSON.stringify(raw);
    errorCode = errorJson?.error?.code;
  } catch (e) {
    console.warn("Whisper error response was not JSON, falling back to text body:", e);
    errorDetails = await response.text();
  }

  // Determine if error is permanent
  const permanent = isPermanentError(response.status, errorCode);

  return new WhisperApiError(
    { status: response.status, statusText: response.statusText, details: errorDetails },
    { permanent, code: errorCode ?? `http_${response.status}` }
  );
}

function isPermanentError(status: number, code: string | undefined): boolean {
  // 4xx errors (except 429 rate limit) are usually permanent
  if (status >= 400 && status < 500 && status !== 429) {
    return true;
  }

  // Specific permanent error codes
  const permanentCodes = ["invalid_api_key", "invalid_request_error", "invalid_file_format"];
  return code !== undefined && permanentCodes.includes(code);
}

function isTranscriptionError(error: unknown): error is TranscriptionError {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    "permanent" in error
  );
}
