/**
 * Audio transcription — dispatches to Whisper, Voxtral, or Deepgram based on
 * box config.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import ky, { type HTTPError } from "ky";
import { transcribeAudioVoxtral } from "./transcription-voxtral.js";
import { transcribeAudioDeepgram } from "./transcription-deepgram.js";

const OPENAI_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";

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
}

export interface WordTimestamp {
  word: string;
  start: number;  // seconds
  end: number;    // seconds
}

export interface DetailedTranscriptionResult extends TranscriptionResult {
  words: WordTimestamp[];
}

export interface TranscriptionOptions {
  wordTimestamps?: boolean;
}

export interface TranscriptionError {
  message: string;
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

export type TranscriptionService = "whisper" | "voxtral" | "deepgram" | "openai-realtime";
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
export type HqTranscriptionService = "whisper" | "whisper-llm" | "whisper-llm-mini" | "voxtral" | "voxtral-diarized";

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

interface StoredTranscriptionConfig {
  service?: TranscriptionService;
  hqService?: HqTranscriptionService;
}

export async function loadTranscriptionConfig(boxRoot?: string): Promise<TranscriptionConfig> {
  const defaults: TranscriptionConfig = { service: "voxtral", hqService: "whisper" };
  if (!boxRoot) return defaults;
  const configPath = path.join(boxRoot, "config/transcription.json");
  let content: string;
  try {
    content = await fs.readFile(configPath, "utf-8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return defaults;
    // Permissions / I/O failures are not the same as "no config" — surface
    // them rather than silently returning defaults.
    throw e;
  }
  // JSON parse errors are real bugs (corrupted config); let them bubble.
  const stored = JSON.parse(content) as StoredTranscriptionConfig;
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
  let current: StoredTranscriptionConfig = {};
  let content: string | null = null;
  try {
    content = await fs.readFile(configPath, "utf-8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") throw e;
    // No file yet — start fresh.
  }
  if (content !== null) {
    // Parse errors are a real bug — let them bubble rather than silently
    // overwriting a corrupted config.
    current = JSON.parse(content) as StoredTranscriptionConfig;
  }
  const merged: StoredTranscriptionConfig = { ...current, ...updates };
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(merged, null, 2) + "\n");
  return loadTranscriptionConfig(boxRoot);
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
 * realtime-only). Same shape as `transcribeAudio` so callers can use
 * either interchangeably; this just routes by the HQ field.
 */
export async function transcribeAudioHq(
  params: TranscribeAudioParams
): Promise<TranscriptionResult | DetailedTranscriptionResult> {
  const config = await loadTranscriptionConfig(params.boxRoot);
  if (config.hqService === "voxtral") {
    return transcribeAudioVoxtral(params);
  }
  if (config.hqService === "voxtral-diarized") {
    return transcribeAudioVoxtral(params, { diarization: true });
  }
  return transcribeAudioWhisper(params, { variant: config.hqService });
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
  opts: { variant: WhisperVariant } = { variant: "whisper" },
): Promise<TranscriptionResult | DetailedTranscriptionResult> {
  const { audioBuffer, filename, prompt, options } = params;
  const apiKey = process.env["THINKING_OPENAI_API_KEY"];
  if (!apiKey) {
    const error: TranscriptionError = {
      message: "THINKING_OPENAI_API_KEY environment variable is required for transcription",
      permanent: true,
      code: "missing_api_key",
    };
    throw error;
  }
  const model = OPENAI_WHISPER_MODELS[opts.variant];
  const isLlm = isLlmWhisperVariant(opts.variant);

  // Detect content type from extension
  const ext = filename.split(".").pop()?.toLowerCase();
  const contentType = getContentType(ext);

  // Build multipart form data
  const boundary = "----FormBoundary" + Math.random().toString(36).substring(2);
  const formParts: Buffer[] = [];

  // Add file field
  formParts.push(
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`
    )
  );
  formParts.push(audioBuffer);
  formParts.push(Buffer.from("\r\n"));

  // Add model field
  formParts.push(
    Buffer.from(
      `--${boundary}\r\n` +
        "Content-Disposition: form-data; name=\"model\"\r\n\r\n" +
        `${model}\r\n`
    )
  );

  // Add response_format field. LLM models only support `json`.
  formParts.push(
    Buffer.from(
      `--${boundary}\r\n` +
        "Content-Disposition: form-data; name=\"response_format\"\r\n\r\n" +
        `${isLlm ? "json" : "verbose_json"}\r\n`
    )
  );

  // timestamp_granularities is whisper-1 only; the LLM models reject it.
  if (!isLlm && options?.wordTimestamps) {
    formParts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          "Content-Disposition: form-data; name=\"timestamp_granularities[]\"\r\n\r\n" +
          "word\r\n"
      )
    );
  }

  // Add prompt if provided
  if (prompt) {
    formParts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          "Content-Disposition: form-data; name=\"prompt\"\r\n\r\n" +
          `${prompt}\r\n`
      )
    );
  }

  // End boundary
  formParts.push(Buffer.from(`--${boundary}--\r\n`));

  const body = Buffer.concat(formParts);

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
      } as DetailedTranscriptionResult;
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
    const httpErr = error as HTTPError;
    if (httpErr.response) {
      const parsed = await parseErrorResponse(httpErr.response);
      throw parsed;
    }

    // Network or other errors are intermittent
    const transcriptionError: TranscriptionError = {
      message: `Network error: ${(error as Error).message}`,
      permanent: false,
      code: "network_error",
    };
    throw transcriptionError;
  }
}

function getContentType(ext: string | undefined): string {
  switch (ext) {
    case "webm":
      return "audio/webm";
    case "mp3":
      return "audio/mpeg";
    case "m4a":
      return "audio/m4a";
    case "wav":
      return "audio/wav";
    case "ogg":
      return "audio/ogg";
    case "flac":
      return "audio/flac";
    default:
      return "audio/webm";
  }
}

async function parseErrorResponse(response: Response): Promise<TranscriptionError> {
  let errorDetails: string;
  let errorCode: string | undefined;

  try {
    const errorJson = (await response.json()) as { error?: { message?: string; code?: string } };
    errorDetails = errorJson.error?.message ?? JSON.stringify(errorJson);
    errorCode = errorJson.error?.code;
  } catch {
    errorDetails = await response.text();
  }

  // Determine if error is permanent
  const permanent = isPermanentError(response.status, errorCode);

  return {
    message: `Whisper API error: ${response.status} ${response.statusText} - ${errorDetails}`,
    permanent,
    code: errorCode ?? `http_${response.status}`,
  };
}

function isPermanentError(status: number, code: string | undefined): boolean {
  // 4xx errors (except 429 rate limit) are usually permanent
  if (status >= 400 && status < 500 && status !== 429) {
    return true;
  }

  // Specific permanent error codes
  const permanentCodes = [
    "invalid_api_key",
    "invalid_request_error",
    "invalid_file_format",
  ];

  if (code && permanentCodes.includes(code)) {
    return true;
  }

  return false;
}

function isTranscriptionError(error: unknown): error is TranscriptionError {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    "permanent" in error
  );
}
