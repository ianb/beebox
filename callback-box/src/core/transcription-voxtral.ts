/**
 * Audio transcription using Mistral Voxtral API.
 */

import ky, { type HTTPError } from "ky";
import type {
  TranscribeAudioParams,
  TranscriptionResult,
  DetailedTranscriptionResult,
  TranscriptionError,
} from "./transcription.js";
import { getMistralApiKey } from "./mistral-key.js";

const VOXTRAL_ENDPOINT = "https://api.mistral.ai/v1/audio/transcriptions";
const VOXTRAL_MODEL = "voxtral-mini-latest";

/**
 * Transcribe audio using Mistral Voxtral API.
 */
export async function transcribeAudioVoxtral(
  params: TranscribeAudioParams
): Promise<TranscriptionResult | DetailedTranscriptionResult> {
  const { audioBuffer, filename, prompt, options, boxRoot } = params;
  const apiKey = await getMistralApiKey(boxRoot);
  if (!apiKey) {
    const error: TranscriptionError = {
      message:
        "Mistral API key not found (checked config/connectors/mistral.secret.json and CALLBACK_MISTRAL_API_KEY env var)",
      permanent: true,
      code: "missing_api_key",
    };
    throw error;
  }

  // Detect content type from extension
  const ext = filename.split(".").pop()?.toLowerCase();
  const contentType = getContentType(ext);

  // Build multipart form data
  const boundary =
    "----FormBoundary" + Math.random().toString(36).substring(2);
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
        'Content-Disposition: form-data; name="model"\r\n\r\n' +
        `${VOXTRAL_MODEL}\r\n`
    )
  );

  // Add timestamp_granularities if word timestamps requested
  if (options?.wordTimestamps) {
    formParts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          'Content-Disposition: form-data; name="timestamp_granularities"\r\n\r\n' +
          "word\r\n"
      )
    );
  }

  // Add context_bias if prompt provided (Voxtral's equivalent of Whisper's prompt)
  if (prompt) {
    formParts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          'Content-Disposition: form-data; name="context_bias"\r\n\r\n' +
          `${prompt}\r\n`
      )
    );
  }

  // End boundary
  formParts.push(Buffer.from(`--${boundary}--\r\n`));

  const body = Buffer.concat(formParts);

  try {
    const result = await ky
      .post(VOXTRAL_ENDPOINT, {
        body,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        retry: 0,
        timeout: 60_000,
      })
      .json<{
        text: string;
        duration?: number;
        language?: string | null;
        segments?: Array<{
          type?: string;
          text: string;
          start: number;
          end: number;
          speaker_id?: string | null;
        }>;
        usage?: { prompt_audio_seconds?: number; total_seconds?: number };
      }>();

    // Voxtral returns duration via usage.prompt_audio_seconds or segments
    const lastSegment = result.segments?.[result.segments.length - 1];
    const duration =
      result.duration ??
      result.usage?.prompt_audio_seconds ??
      result.usage?.total_seconds ??
      lastSegment?.end ??
      0;

    const language = result.language ?? "unknown";

    // With timestamp_granularities=["word"], each segment is a single word
    if (options?.wordTimestamps && result.segments && result.segments.length > 0) {
      const words = result.segments.map((s) => ({
        word: s.text.trim(),
        start: s.start,
        end: s.end,
      }));
      return {
        text: result.text,
        duration,
        language,
        words,
      } as DetailedTranscriptionResult;
    }

    return {
      text: result.text,
      duration,
      language,
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

async function parseErrorResponse(
  response: Response
): Promise<TranscriptionError> {
  let errorDetails: string;
  let errorCode: string | undefined;

  try {
    const errorJson = (await response.json()) as {
      error?: { message?: string; code?: string };
      message?: string;
    };
    errorDetails =
      errorJson.error?.message ?? errorJson.message ?? JSON.stringify(errorJson);
    errorCode = errorJson.error?.code;
  } catch {
    errorDetails = await response.text();
  }

  const permanent = isPermanentError(response.status, errorCode);

  return {
    message: `Voxtral API error: ${response.status} ${response.statusText} - ${errorDetails}`,
    permanent,
    code: errorCode ?? `http_${response.status}`,
  };
}

function isPermanentError(
  status: number,
  code: string | undefined
): boolean {
  if (status >= 400 && status < 500 && status !== 429) {
    return true;
  }

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

function isTranscriptionError(
  error: unknown
): error is TranscriptionError {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    "permanent" in error
  );
}
