/**
 * Audio transcription using Deepgram's prerecorded REST API.
 *
 * Used by the file-based transcribeAudio() dispatch (CLI commands like
 * wakeup). Realtime browser transcription goes through a temp key + direct
 * client connection — see frontend/src/lib/deepgram-key.ts.
 */

import ky, { type HTTPError } from "ky";
import type {
  TranscribeAudioParams,
  TranscriptionResult,
  DetailedTranscriptionResult,
  TranscriptionError,
} from "./transcription.js";
import { getDeepgramCredentials } from "./deepgram-key.js";

const DEEPGRAM_ENDPOINT = "https://api.deepgram.com/v1/listen";
const DEEPGRAM_MODEL = "nova-3";

interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  punctuated_word?: string;
}

interface DeepgramAlternative {
  transcript: string;
  paragraphs?: {
    transcript: string;
    paragraphs?: Array<{
      sentences: Array<{ text: string; start: number; end: number }>;
      start: number;
      end: number;
    }>;
  };
  words?: DeepgramWord[];
}

interface DeepgramChannel {
  alternatives: DeepgramAlternative[];
  detected_language?: string;
}

interface DeepgramResponse {
  metadata?: { duration?: number };
  results?: { channels?: DeepgramChannel[] };
}

export async function transcribeAudioDeepgram(
  params: TranscribeAudioParams
): Promise<TranscriptionResult | DetailedTranscriptionResult> {
  const { audioBuffer, filename, options, boxRoot } = params;
  const creds = await getDeepgramCredentials(boxRoot);
  if (!creds) {
    const error: TranscriptionError = {
      message:
        "Deepgram API key not found (checked config/connectors/deepgram.secret.json and CALLBACK_DEEPGRAM_API_KEY env var)",
      permanent: true,
      code: "missing_api_key",
    };
    throw error;
  }

  const ext = filename.split(".").pop()?.toLowerCase();
  const contentType = getContentType(ext);

  const url = new URL(DEEPGRAM_ENDPOINT);
  url.searchParams.set("model", DEEPGRAM_MODEL);
  url.searchParams.set("smart_format", "true");
  url.searchParams.set("paragraphs", "true");
  url.searchParams.set("punctuate", "true");
  url.searchParams.set("detect_language", "true");
  url.searchParams.set("mip_opt_out", "true");

  try {
    const result = await ky
      .post(url.toString(), {
        body: new Uint8Array(audioBuffer),
        headers: {
          Authorization: `Token ${creds.apiKey}`,
          "Content-Type": contentType,
        },
        retry: 2,
        timeout: 120_000,
      })
      .json<DeepgramResponse>();

    const channel = result.results?.channels?.[0];
    const alt = channel?.alternatives?.[0];
    const text = (alt?.paragraphs?.transcript ?? alt?.transcript ?? "").trim();
    const duration = result.metadata?.duration ?? 0;
    const language = channel?.detected_language ?? "unknown";

    if (options?.wordTimestamps && alt?.words) {
      const words = alt.words.map((w) => ({
        word: w.punctuated_word ?? w.word,
        start: w.start,
        end: w.end,
      }));
      return {
        text,
        duration,
        language,
        words,
      } as DetailedTranscriptionResult;
    }

    return { text, duration, language };
  } catch (error) {
    if (isTranscriptionError(error)) {
      throw error;
    }
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

async function parseErrorResponse(response: Response): Promise<TranscriptionError> {
  let errorDetails: string;
  let errorCode: string | undefined;
  try {
    const errorJson = (await response.json()) as {
      err_msg?: string;
      err_code?: string;
      error?: string;
      message?: string;
    };
    errorDetails =
      errorJson.err_msg ?? errorJson.error ?? errorJson.message ?? JSON.stringify(errorJson);
    errorCode = errorJson.err_code;
  } catch (_e) {
    errorDetails = await response.text();
  }

  const permanent = isPermanentError(response.status, errorCode);

  return {
    message: `Deepgram API error: ${response.status} ${response.statusText} - ${errorDetails}`,
    permanent,
    code: errorCode ?? `http_${response.status}`,
  };
}

function isPermanentError(status: number, code: string | undefined): boolean {
  if (status >= 400 && status < 500 && status !== 429) {
    return true;
  }
  const permanentCodes = [
    "INVALID_AUTH",
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
