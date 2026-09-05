/**
 * Multipart request building and response shaping for the Voxtral
 * transcription client — the wire-format details (form fields, content
 * types, granularity rules) and the diarization debug logging, kept
 * separate from the high-level transcribe orchestration.
 */

import type {
  TranscribeAudioParams,
  TranscriptionResult,
  DetailedTranscriptionResult,
} from "./index.js";
import {
  buildDiarizedText,
  joinSegmentTexts,
  repairMissingSentenceSpaces,
} from "./voxtral-text.js";
import { buildMultipartForm, type MultipartPart } from "../../lib/multipart.js";

const VOXTRAL_MODEL = "voxtral-mini-latest";

export interface VoxtralResponse {
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
}

function getContentType(ext: string | undefined): string {
  switch (ext ?? "") {
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

// timestamp_granularities — `word` for per-word timing, `segment` for
// diarization (Mistral requires segment granularity when diarize=true;
// without it the API returns 422). Word timestamps and diarization are
// mutually exclusive here; word wins if both are requested.
function granularityFor(
  { wordTimestamps, diarization }: { wordTimestamps: boolean; diarization: boolean },
): "word" | "segment" | null {
  if (wordTimestamps) return "word";
  if (diarization) return "segment";
  return null;
}

/**
 * Build the multipart/form-data body for a Voxtral transcription request
 * and the boundary string used in its Content-Type header.
 */
export function buildVoxtralRequestBody(
  params: TranscribeAudioParams,
  { diarization }: { diarization: boolean },
): { body: Buffer<ArrayBuffer>; boundary: string } {
  const { audioBuffer, filename, prompt, options } = params;
  const ext = filename.split(".").pop()?.toLowerCase();
  const contentType = getContentType(ext);

  const parts: MultipartPart[] = [
    {
      kind: "file",
      file: { name: "file", filename, contentType, data: audioBuffer },
    },
    { kind: "field", field: { name: "model", value: VOXTRAL_MODEL } },
  ];

  const wordTimestamps = options?.wordTimestamps === true;
  const granularity = granularityFor({ wordTimestamps, diarization });
  if (granularity) {
    parts.push({ kind: "field", field: { name: "timestamp_granularities", value: granularity } });
  }

  // Diarization flag. Mistral's parameter is `diarize` (not `diarization`)
  // — sending the wrong name is silently ignored and you get an
  // unlabeled transcript back.
  if (diarization && !wordTimestamps) {
    parts.push({ kind: "field", field: { name: "diarize", value: "true" } });
  }

  // Add context_bias if prompt provided (Voxtral's equivalent of Whisper's prompt)
  if (prompt) {
    parts.push({ kind: "field", field: { name: "context_bias", value: prompt } });
  }

  return buildMultipartForm(parts);
}

/**
 * Warn when diarization was requested but no segment carries a speaker id —
 * the response shape probably changed. Says nothing on success: this runs
 * inside `bbx chat retranscribe`, whose output the calling agent reads in
 * full (stderr included), so routine diagnostics are pure noise there.
 */
export function warnIfDiarizationUnlabeled(result: VoxtralResponse): void {
  const segCount = result.segments?.length ?? 0;
  const labeled = result.segments?.filter(
    (s) => typeof s.speaker_id === "string" && s.speaker_id.length > 0,
  ).length ?? 0;
  if (segCount > 0 && labeled === 0) {
    console.warn(
      "[voxtral-diarized] no speaker_id on any segment; first segment keys: " +
        JSON.stringify(Object.keys(result.segments?.[0] ?? {})),
    );
  }
}

/**
 * Voxtral returns duration via `duration`, `usage.prompt_audio_seconds`,
 * `usage.total_seconds`, or the last segment's end — whichever is first
 * present.
 */
function resolveDuration(result: VoxtralResponse): number {
  const lastSegment = result.segments?.[result.segments.length - 1];
  return (
    result.duration ??
    result.usage?.prompt_audio_seconds ??
    result.usage?.total_seconds ??
    lastSegment?.end ??
    0
  );
}

/**
 * Shape a parsed Voxtral response into a transcription result, applying
 * word-timestamp extraction, diarized speaker labeling, and the
 * segment-rejoin / sentence-spacing repairs as appropriate.
 */
export function shapeVoxtralResult(
  result: VoxtralResponse,
  { diarization, wordTimestamps }: { diarization: boolean; wordTimestamps: boolean },
): TranscriptionResult | DetailedTranscriptionResult {
  const duration = resolveDuration(result);
  const language = result.language ?? "unknown";

  // With timestamp_granularities=["word"], each segment is a single word
  if (wordTimestamps && result.segments && result.segments.length > 0) {
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
    } satisfies DetailedTranscriptionResult;
  }

  // Diarization: rewrite the text as speaker-prefixed lines using each
  // segment's speaker_id. Voxtral returns ids like "speaker_0";
  // buildDiarizedText turns those into "Speaker 0" for readability.
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
}
