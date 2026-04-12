/**
 * Audio transcription — dispatches to Whisper or Voxtral based on box config.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import ky, { type HTTPError } from "ky";
import { transcribeAudioVoxtral } from "./transcription-voxtral.js";

const OPENAI_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_MODEL = "whisper-1";

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

interface TranscriptionConfig {
  service: "whisper" | "voxtral";
}

async function loadTranscriptionConfig(boxRoot?: string): Promise<TranscriptionConfig> {
  if (!boxRoot) return { service: "voxtral" };
  try {
    const configPath = path.join(boxRoot, "config/transcription.json");
    const content = await fs.readFile(configPath, "utf-8");
    return JSON.parse(content) as TranscriptionConfig;
  } catch {
    return { service: "voxtral" };
  }
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
  return transcribeAudioWhisper(params);
}

/**
 * Transcribe audio using OpenAI Whisper API.
 */
async function transcribeAudioWhisper(
  params: TranscribeAudioParams
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
        `${OPENAI_MODEL}\r\n`
    )
  );

  // Add response_format field
  formParts.push(
    Buffer.from(
      `--${boundary}\r\n` +
        "Content-Disposition: form-data; name=\"response_format\"\r\n\r\n" +
        "verbose_json\r\n"
    )
  );

  // Add timestamp_granularities if word timestamps requested
  if (options?.wordTimestamps) {
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
        duration: number;
        language: string;
        words?: Array<{ word: string; start: number; end: number }>;
      }>();

    if (options?.wordTimestamps && result.words) {
      return {
        text: result.text,
        duration: result.duration,
        language: result.language,
        words: result.words.map((w) => ({
          word: w.word,
          start: w.start,
          end: w.end,
        })),
      } as DetailedTranscriptionResult;
    }

    return {
      text: result.text,
      duration: result.duration,
      language: result.language,
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
