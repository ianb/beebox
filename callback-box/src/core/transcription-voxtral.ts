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
 *
 * `opts.diarization` enables Voxtral's speaker-labeling. When on, each
 * returned segment includes a `speaker_id` and the function rewrites
 * the response text as speaker-prefixed lines ("Speaker 0: …\n
 * Speaker 1: …") so the agent sees who said what.
 */
export async function transcribeAudioVoxtral(
  params: TranscribeAudioParams,
  opts: { diarization?: boolean } = {},
): Promise<TranscriptionResult | DetailedTranscriptionResult> {
  const { audioBuffer, filename, prompt, options, boxRoot } = params;
  const diarization = opts.diarization === true;
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

  // timestamp_granularities — `word` for per-word timing, `segment` for
  // diarization (Mistral requires segment granularity when diarize=true;
  // without it the API returns 422). Word timestamps and diarization are
  // mutually exclusive here; word wins if both are requested.
  const granularity = options?.wordTimestamps
    ? "word"
    : diarization
      ? "segment"
      : null;
  if (granularity) {
    formParts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          'Content-Disposition: form-data; name="timestamp_granularities"\r\n\r\n' +
          `${granularity}\r\n`
      )
    );
  }

  // Diarization flag. Mistral's parameter is `diarize` (not `diarization`)
  // — sending the wrong name is silently ignored and you get an
  // unlabeled transcript back.
  if (diarization && !options?.wordTimestamps) {
    formParts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          'Content-Disposition: form-data; name="diarize"\r\n\r\n' +
          "true\r\n"
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
        retry: 2,
        timeout: 120_000,
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

    if (diarization) {
      const segCount = result.segments?.length ?? 0;
      const labeled = result.segments?.filter(
        (s) => typeof s.speaker_id === "string" && s.speaker_id.length > 0,
      ).length ?? 0;
      const speakers = new Set(
        (result.segments ?? [])
          .map((s) => s.speaker_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      );
      console.log(
        `[voxtral-diarized] segments=${segCount} labeled=${labeled} ` +
          `unique-speakers=${speakers.size} ids=${JSON.stringify([...speakers])}`,
      );
      if (segCount > 0 && labeled === 0) {
        console.log(
          "[voxtral-diarized] no speaker_id on any segment; first segment keys: " +
            JSON.stringify(Object.keys(result.segments?.[0] ?? {})),
        );
      }
    }

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

    // Diarization: rewrite the text as speaker-prefixed lines using each
    // segment's speaker_id. Voxtral returns ids like "speaker_0";
    // formatSpeakerLabel turns those into "Speaker 0" for readability.
    // Falls back to the flat `text` if no segments came back labeled.
    const labeledText = diarization ? buildDiarizedText(result.segments) : null;

    // Voxtral's top-level `text` sometimes concatenates sentence-end
    // segments without spacing ("have gone.Generic tools"). When segments
    // are present, rebuild text from them joined with a single space —
    // this fixes the bug at its source. Falls back to the raw `text`
    // (then a regex safety net) when segments are empty.
    const text = labeledText
      ?? joinSegmentTexts(result.segments)
      ?? repairMissingSentenceSpaces(result.text);

    return {
      text,
      duration,
      language,
      diarized: labeledText !== null,
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

/**
 * Voxtral occasionally concatenates segments without inter-sentence
 * spacing — "have gone.Generic tools" instead of "have gone. Generic
 * tools". Insert a space after `.`/`!`/`?` when the next char is a
 * letter, leaving decimal numbers ("v1.2"), ellipses ("..."), and other
 * non-letter sequences alone.
 */
/**
 * Rebuild transcript text from Voxtral segments — segments carry the
 * authoritative per-chunk text without the inter-sentence spacing bug
 * that affects the top-level `text` field. Joined with a single space;
 * empty/whitespace-only segments dropped. Returns null when no usable
 * segment text is available (callers fall back to `text`).
 *
 * Only safe in the non-word-timestamps path — when word timestamps are
 * on, each segment is a single word and joining is the caller's job.
 */
export function joinSegmentTexts(
  segments: Array<{ text: string }> | undefined,
): string | null {
  if (!segments || segments.length === 0) return null;
  const pieces = segments
    .map((s) => s.text.trim())
    .filter((s) => s.length > 0);
  if (pieces.length === 0) return null;
  return pieces.join(" ");
}

/**
 * Safety net for when `segments` is empty — same intent as joining from
 * segments, but applied directly to the joined text. Inserts a space
 * after `.`/`!`/`?` when the next char is a letter, leaving decimals,
 * money, and ellipses alone.
 */
export function repairMissingSentenceSpaces(text: string): string {
  return text.replace(/([!.?])([A-Za-z])/g, "$1 $2");
}

/**
 * Build a speaker-prefixed transcript from Voxtral diarized segments.
 * Consecutive segments from the same speaker are merged into one block.
 * Returns null if no segments have a speaker_id (e.g. mono speaker, or
 * diarization didn't run).
 */
function buildDiarizedText(
  segments: Array<{ text: string; speaker_id?: string | null }> | undefined,
): string | null {
  if (!segments || segments.length === 0) return null;
  if (!segments.some((s) => typeof s.speaker_id === "string" && s.speaker_id.length > 0)) {
    return null;
  }
  const lines: string[] = [];
  let currentSpeaker: string | null = null;
  let currentText: string[] = [];
  function flush(): void {
    if (currentSpeaker === null || currentText.length === 0) return;
    lines.push(`${formatSpeakerLabel(currentSpeaker)}: ${currentText.join(" ").trim()}`);
    currentText = [];
  }
  for (const seg of segments) {
    const speaker = (typeof seg.speaker_id === "string" && seg.speaker_id.length > 0)
      ? seg.speaker_id
      : "unknown";
    if (speaker !== currentSpeaker) {
      flush();
      currentSpeaker = speaker;
    }
    currentText.push(seg.text.trim());
  }
  flush();
  return lines.join("\n");
}

/**
 * Find the most recent speaker-letter used in prior text (e.g. a chat
 * session log). Scans for `Speaker N<L>` where L is A-Z and returns the
 * last L found, or null if none. Used to advance the per-recording
 * letter so the agent can tell that speakers in one recording aren't
 * the same people as the same numbers in a different recording.
 */
export function findLastSpeakerLetter(text: string): string | null {
  const re = /\bSpeaker \d+([A-Z])\b/g;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) last = m[1] ?? last;
  return last;
}

/**
 * Next letter A-Z, wrapping Z→A. Null input → "A".
 */
export function nextSpeakerLetter(prev: string | null): string {
  if (prev === null || prev === "Z") return "A";
  const code = prev.codePointAt(0);
  if (code === undefined) return "A";
  return String.fromCodePoint(code + 1);
}

/**
 * Rewrite raw Voxtral speaker labels ("Speaker 0", "Speaker 1", …) into
 * session-tagged 1-indexed labels ("Speaker 1A", "Speaker 2A", …) so the
 * agent sees a fresh identifier per recording.
 */
export function relabelDiarizedSpeakers(text: string, letter: string): string {
  return text.replace(/\bSpeaker (\d+)\b/g, (_, n) => `Speaker ${Number(n) + 1}${letter}`);
}

function formatSpeakerLabel(speakerId: string): string {
  // "speaker_0" → "Speaker 0", "speaker_1" → "Speaker 1", fallback to raw.
  const m = speakerId.match(/^speaker[_-]?(\d+)$/i);
  if (m) return `Speaker ${m[1]}`;
  return speakerId;
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
