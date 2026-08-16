/**
 * Audio transcription — dispatches to Whisper, Voxtral, or Deepgram based on
 * box config.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import ky, { isHTTPError } from "ky";
import { z } from "zod";
import { transcribeAudioVoxtral } from "./voxtral.js";
import { transcribeAudioDeepgram } from "./deepgram.js";
import { transcribeAudioFake } from "./fake.js";
import { withCardLock } from "../../lib/card-lock.js";
import { buildMultipartForm, type MultipartPart } from "../../lib/multipart.js";
import { errnoCode, errorMessage } from "../../lib/error-guards.js";

const OPENAI_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";

class MissingWhisperKeyError extends Error implements TranscriptionError {
  readonly permanent = true;
  readonly code = "missing_api_key";
  constructor() {
    super("THINKING_OPENAI_API_KEY environment variable is required for transcription");
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
type WhisperVariant = keyof typeof OPENAI_WHISPER_MODELS;
function isLlmWhisperVariant(variant: WhisperVariant): boolean {
  return variant === "whisper-llm" || variant === "whisper-llm-mini";
}

export interface TranscriptionResult {
  text: string;
  duration: number;
  language: string;
  /**
   * True when the service ran diarization AND returned speaker-labeled
   * segments. False/absent for non-diarized passes or when diarization
   * was requested but produced no usable speaker ids (e.g. mono speaker).
   */
  diarized?: boolean;
  /**
   * The actually-resolved service name that produced this result
   * (retranscription-in-chat plan, Track 2) — set only by
   * {@link transcribeAudioHq}, which is the one caller that can resolve
   * "box default" to a concrete name. The batch `transcribeAudio` dispatch
   * and the individual per-service functions leave it unset.
   */
  service?: string;
}

export interface WordTimestamp {
  word: string;
  start: number;  // seconds
  end: number;    // seconds
  /**
   * Per-word acoustic confidence (0–1), when the backend reports one.
   * Only Deepgram does; absent means "no confidence data backs this
   * word" — not "confident" and not "low confidence".
   */
  confidence?: number;
}

export interface DetailedTranscriptionResult extends TranscriptionResult {
  words: WordTimestamp[];
}

export interface TranscriptionOptions {
  wordTimestamps?: boolean;
}

export interface TranscriptionError extends Error {
  permanent: boolean; // If true, don't retry
  code?: string;
}

/**
 * Parameters for transcribeAudio
 */
export interface TranscribeAudioParams {
  audioBuffer: Buffer;
  filename: string;
  prompt?: string;
  options?: TranscriptionOptions;
  boxRoot?: string;
}

export const TRANSCRIPTION_SERVICES = ["whisper", "voxtral", "deepgram", "openai-realtime", "fake"] as const;
export type TranscriptionService = (typeof TRANSCRIPTION_SERVICES)[number];
/**
 * Narration mode's checkpoint HQ pass — non-streaming services only.
 * - `whisper`: OpenAI's classic `whisper-1` model.
 * - `whisper-llm`: OpenAI's full LLM-based audio transcription
 *   (`gpt-4o-transcribe`). Higher quality, slower, more expensive.
 * - `whisper-llm-mini`: Smaller/faster/cheaper LLM variant
 *   (`gpt-4o-mini-transcribe`).
 * - `voxtral`: Mistral's Voxtral non-streaming model.
 * - `voxtral-diarized`: Voxtral with diarization on — output is
 *   speaker-prefixed lines ("Speaker 0: …\nSpeaker 1: …").
 */
export const HQ_TRANSCRIPTION_SERVICES = ["whisper", "whisper-llm", "whisper-llm-mini", "voxtral", "voxtral-diarized"] as const;
export type HqTranscriptionService = (typeof HQ_TRANSCRIPTION_SERVICES)[number];

export interface TranscriptionConfig {
  /**
   * Realtime / batch service used by the live transcription path and the
   * existing batch `transcribeAudio` call. Streaming-capable values:
   * `voxtral`, `deepgram`, `openai-realtime`. The non-streaming `whisper`
   * falls back to voxtral on the realtime path. The `openai-realtime`
   * service (OpenAI gpt-realtime-whisper) is realtime-only — batch calls
   * fall back to classic whisper.
   */
  service: TranscriptionService;
  /**
   * Service used by the narration-mode HQ pass (POST /api/chat/transcribe-audio).
   * Independent from `service` so a box can stream with deepgram but run
   * HQ with whisper. Defaults to `whisper` when not stored.
   */
  hqService: HqTranscriptionService;
}

const storedTranscriptionConfigSchema = z.object({
  service: z.enum(TRANSCRIPTION_SERVICES).optional(),
  hqService: z.enum(HQ_TRANSCRIPTION_SERVICES).optional(),
});
type StoredTranscriptionConfig = z.infer<typeof storedTranscriptionConfigSchema>;

export async function loadTranscriptionConfig(boxRoot?: string): Promise<TranscriptionConfig> {
  const defaults: TranscriptionConfig = { service: "voxtral", hqService: "whisper" };
  if (!boxRoot) return defaults;
  const configPath = path.join(boxRoot, "config/transcription.json");
  let content: string;
  try {
    content = await fs.readFile(configPath, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return defaults;
    // Permissions / I/O failures are not the same as "no config" — surface
    // them rather than silently returning defaults.
    throw e;
  }
  // JSON parse / schema errors are real bugs (corrupted config); let them bubble.
  const stored = storedTranscriptionConfigSchema.parse(JSON.parse(content));
  return {
    service: stored.service ?? defaults.service,
    hqService: stored.hqService ?? defaults.hqService,
  };
}

/**
 * Persist a partial config update, merging with whatever's on disk.
 */
export async function updateTranscriptionConfig(
  boxRoot: string,
  updates: Partial<StoredTranscriptionConfig>,
): Promise<TranscriptionConfig> {
  const configPath = path.join(boxRoot, "config/transcription.json");
  // Serialize the read-merge-write so concurrent setService/setHqService
  // updates can't both read the old config and drop one's change.
  return withCardLock(configPath, async () => {
    let current: StoredTranscriptionConfig = {};
    let content: string | null = null;
    try {
      content = await fs.readFile(configPath, "utf-8");
    } catch (e) {
      if (errnoCode(e) !== "ENOENT") throw e;
      // No file yet — start fresh.
    }
    if (content !== null) {
      // Parse / schema errors are a real bug — let them bubble rather than
      // silently overwriting a corrupted config.
      current = storedTranscriptionConfigSchema.parse(JSON.parse(content));
    }
    const merged: StoredTranscriptionConfig = { ...current, ...updates };
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(merged, null, 2) + "\n");
    return loadTranscriptionConfig(boxRoot);
  });
}

/**
 * Transcribe audio using the configured service (Whisper or Voxtral).
 *
 * @param params - Parameters object
 * @returns Transcription result
 * @throws TranscriptionError on failure
 */
export async function transcribeAudio(
  params: TranscribeAudioParams
): Promise<TranscriptionResult | DetailedTranscriptionResult> {
  const config = await loadTranscriptionConfig(params.boxRoot);
  if (config.service === "fake") {
    return transcribeAudioFake(params);
  }
  if (config.service === "voxtral") {
    return transcribeAudioVoxtral(params);
  }
  if (config.service === "deepgram") {
    return transcribeAudioDeepgram(params);
  }
  // openai-realtime is streaming-only; fall back to classic whisper for
  // file-based batch transcription.
  return transcribeAudioWhisper(params);
}

/**
 * HQ transcription pass for narration mode's checkpoint flow. Uses the
 * `hqService` config field (any non-deepgram service — deepgram is
 * realtime-only), unless the caller picks a service explicitly
 * (`cb chat retranscribe --service ...`). Same shape as `transcribeAudio`
 * so callers can use either interchangeably; this just routes by service.
 */
export async function transcribeAudioHq(
  params: TranscribeAudioParams,
  overrides?: { service?: HqTranscriptionService | undefined }
): Promise<TranscriptionResult | DetailedTranscriptionResult> {
  const service = overrides?.service ?? (await loadTranscriptionConfig(params.boxRoot)).hqService;
  const result = await dispatchHqTranscription(params, service);
  // Stamp the resolved name on the result — the one place that knows it,
  // since callers only ever pass in the unresolved `overrides?.service`.
  return { ...result, service };
}

function dispatchHqTranscription(
  params: TranscribeAudioParams,
  service: HqTranscriptionService,
): Promise<TranscriptionResult | DetailedTranscriptionResult> {
  if (service === "voxtral") {
    return transcribeAudioVoxtral(params);
  }
  if (service === "voxtral-diarized") {
    return transcribeAudioVoxtral(params, { diarization: true });
  }
  return transcribeAudioWhisper(params, { variant: service });
}

/**
 * Transcribe audio using OpenAI Whisper API.
 *
 * `variant` picks the underlying model:
 * - `whisper` (default): classic `whisper-1`. Returns verbose_json with
 *   duration, language, and optional word timestamps.
 * - `whisper-llm` / `whisper-llm-mini`: the newer LLM-based audio models
 *   (`gpt-4o-transcribe`, `gpt-4o-mini-transcribe`). These only support
 *   `response_format: "json"` and don't return duration, language, or
 *   timestamps — we fill those with empty defaults.
 */
async function transcribeAudioWhisper(
  params: TranscribeAudioParams,
  opts?: { variant: WhisperVariant },
): Promise<TranscriptionResult | DetailedTranscriptionResult> {
  opts = opts ?? { variant: "whisper" };
  const { audioBuffer, filename, prompt, options } = params;
  const apiKey = process.env["THINKING_OPENAI_API_KEY"];
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
