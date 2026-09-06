/**
 * The HQ transcription pass over OpenRouter — the same models the direct arms
 * use, reached through the aggregator when the box holds no key of its own for
 * them (`core/openrouter.ts` decides which). One module covers every HQ variant
 * because OpenRouter normalizes the providers behind a single request and a
 * single response shape, which the direct arms emphatically do not share.
 *
 * **Only the HQ pass routes here.** `transcribeAudio` — the capture and
 * transcribe-preaction path — can carry a `prompt` that biases the model toward
 * a card's existing content (Whisper's `prompt`, Voxtral's `context_bias`), and
 * OpenRouter's transcription request has no parameter for it. A dropped bias is
 * a quality regression nobody would see, so the batch path stays direct and
 * this one warns if a prompt ever reaches it.
 *
 * **The request is JSON, not multipart.** Both forms exist upstream, and the
 * multipart one caps at 25 MB where the JSON one does not — a recording long
 * enough to hit that is the ordinary case here, so JSON it is.
 *
 * **The provider is not pinned, and does not need to be.** Unlike embeddings
 * and chat, OpenRouter's transcription request takes no `only`/`data_collection`
 * preferences — just provider-specific option passthrough. Checked 2026-09-06:
 * every model id below has exactly one serving provider (OpenAI for the Whisper
 * family, Mistral for Voxtral), so the request reaches the same company the
 * direct call would have regardless. If a second provider ever appears for one
 * of them, that assumption is what breaks.
 */

import ky from "ky";
import { isRecord } from "../../lib/is-record.js";
import { OPENROUTER_BASE_URL } from "../openrouter.js";
import { buildDiarizedText, joinSegmentTexts, repairMissingSentenceSpaces } from "./voxtral-text.js";
import type {
  DetailedTranscriptionResult,
  HqTranscriptionService,
  TranscribeAudioParams,
  TranscriptionError,
  TranscriptionResult,
  WordTimestamp,
} from "./index.js";

/**
 * OpenRouter answered, but not with a transcript. Permanent: a response
 * missing its own required field is a contract change, and retrying the same
 * request will produce the same non-answer.
 */
class OpenRouterTranscriptionShapeError extends Error implements TranscriptionError {
  readonly permanent = true;
  readonly code = "bad_response_shape";
  constructor({ missing }: { missing: "object" | "text" }) {
    super(`OpenRouter transcription response is unusable: expected ${missing}`);
    this.name = "OpenRouterTranscriptionShapeError";
  }
}

/**
 * Each HQ service's model id on OpenRouter, and whether that model can answer
 * in `verbose_json`. The two LLM audio models cannot — same limitation they
 * have when called directly, where the direct arm fills duration and language
 * with empty defaults for exactly this reason.
 */
const OPENROUTER_HQ_MODELS: Record<HqTranscriptionService, { model: string; verbose: boolean }> = {
  whisper: { model: "openai/whisper-1", verbose: true },
  "whisper-llm": { model: "openai/gpt-4o-transcribe", verbose: false },
  "whisper-llm-mini": { model: "openai/gpt-4o-mini-transcribe", verbose: false },
  voxtral: { model: "mistralai/voxtral-mini-transcribe", verbose: true },
  "voxtral-diarized": { model: "mistralai/voxtral-mini-transcribe", verbose: true },
};

/** Said once per process, not once per recording. */
let warnedAboutDroppedPrompt = false;

/**
 * The formats the direct Whisper arm recognizes, and therefore the ones this
 * one does. OpenRouter takes a bare format token where the direct arm sends a
 * MIME type, but the mapping from a filename must agree: the same recording
 * must not be read as webm on one route and something else on the other.
 */
const AUDIO_FORMATS = new Set(["webm", "mp3", "m4a", "wav", "ogg", "flac"]);

/**
 * `memo.wav` → `wav`. An unrecognized or absent extension falls back to `webm`
 * — the same guess `getContentType` makes in `whisper.ts`, and the format the
 * browser recorder actually produces.
 */
export function audioFormatToken(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const ext = dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
  return AUDIO_FORMATS.has(ext) ? ext : "webm";
}

export async function transcribeAudioOpenRouter(
  apiKey: string,
  { service, ...params }: TranscribeAudioParams & { service: HqTranscriptionService },
): Promise<TranscriptionResult | DetailedTranscriptionResult> {
  const { model, verbose } = OPENROUTER_HQ_MODELS[service];
  const diarization = service === "voxtral-diarized";
  const wordTimestamps = params.options?.wordTimestamps === true;

  if (params.prompt !== undefined && params.prompt !== "" && !warnedAboutDroppedPrompt) {
    warnedAboutDroppedPrompt = true;
    console.warn(
      "[transcription/openrouter] context-biasing prompt dropped: OpenRouter's transcription request has no " +
        "prompt/context_bias parameter. Grant this box the provider's own key to keep the bias.",
    );
  }

  // `["word"]` implies segment timestamps too, so the diarized variant asks for
  // words when both are wanted and reads speakers off the segments either way.
  const granularities = wordTimestamps ? ["word"] : diarization ? ["segment"] : undefined;

  const body = await ky
    .post("audio/transcriptions", {
      prefixUrl: OPENROUTER_BASE_URL,
      headers: { Authorization: `Bearer ${apiKey}` },
      retry: 2,
      timeout: 120_000,
      json: {
        model,
        input_audio: { data: params.audioBuffer.toString("base64"), format: audioFormatToken(params.filename) },
        response_format: verbose ? "verbose_json" : "json",
        ...(verbose && granularities !== undefined && { timestamp_granularities: granularities }),
        // Diarization is not a normalized OpenRouter parameter — asking for
        // segment timestamps gets you segments, not speakers. It reaches
        // Mistral the only way it can, through the provider-option
        // passthrough, under the same `diarize` name the direct arm uses
        // (`voxtral-request.ts`: the wrong name is silently ignored and you
        // get an unlabeled transcript back).
        ...(diarization && { provider: { options: { mistral: { diarize: true } } } }),
      },
    })
    .json<unknown>();

  const result = shapeOpenRouterResult(body, { diarization, wordTimestamps });
  // A passthrough option that the provider ignores fails silently by
  // construction, and an unlabeled transcript looks exactly like a
  // single-speaker recording. Say so rather than letting the caller believe
  // diarization ran — the same guard `warnIfDiarizationUnlabeled` gives the
  // direct arm.
  if (diarization && result.diarized !== true) {
    console.warn(
      "[transcription/openrouter] diarization requested but no speaker labels came back. Either the recording has " +
        "one speaker, or OpenRouter did not forward the provider's `diarize` option.",
    );
  }
  return result;
}

interface ParsedSegment {
  text: string;
  /** Segment end in seconds, when the provider timed it — the duration ladder's last rung. */
  end?: number;
  speaker_id?: string | null;
}

/**
 * Turn OpenRouter's normalized response into the shape every transcription
 * caller already handles. Deliberately mirrors `shapeVoxtralResult`'s
 * decisions — word timestamps win, then diarized speaker lines, then segment
 * rejoining, then the raw text — so a box switching routes sees the same
 * transcript structure it saw before.
 *
 * OpenRouter reports a speaker as a NUMBER on each word and segment, where
 * Voxtral reports a `speaker_id` string; the number is renamed here so the
 * shared `buildDiarizedText` keeps producing "Speaker 0:" lines.
 */
export function shapeOpenRouterResult(
  body: unknown,
  { diarization, wordTimestamps }: { diarization: boolean; wordTimestamps: boolean },
): TranscriptionResult | DetailedTranscriptionResult {
  if (!isRecord(body)) throw new OpenRouterTranscriptionShapeError({ missing: "object" });
  if (typeof body["text"] !== "string") {
    throw new OpenRouterTranscriptionShapeError({ missing: "text" });
  }
  const rawText = body["text"];
  const language = typeof body["language"] === "string" ? body["language"] : "unknown";
  const segments = parseSegments(body["segments"]);
  const words = parseWords(body["words"]);
  const duration = resolveDuration(body, { segments, words });

  if (wordTimestamps && words !== null) {
    return { text: rawText, duration, language, words } satisfies DetailedTranscriptionResult;
  }

  const labeledText = diarization ? buildDiarizedText(segments) : null;
  const text = labeledText ?? joinSegmentTexts(segments) ?? repairMissingSentenceSpaces(rawText);
  return { text, duration, language, diarized: labeledText !== null };
}

/**
 * Duration, in the order the answer is most likely to be right: the top-level
 * field, then the seconds of audio OpenRouter says it billed for, then the end
 * of the last thing it timed. Mirrors the direct Voxtral arm's ladder
 * (`voxtral-request.ts`) rather than reporting `0s` for a successful pass —
 * duration lands in a card's frontmatter, where a zero reads as fact.
 */
function resolveDuration(
  body: Record<string, unknown>,
  { segments, words }: { segments: ParsedSegment[] | undefined; words: WordTimestamp[] | null },
): number {
  if (typeof body["duration"] === "number") return body["duration"];
  const usage = body["usage"];
  if (isRecord(usage) && typeof usage["seconds"] === "number") return usage["seconds"];
  return segments?.[segments.length - 1]?.end ?? words?.[words.length - 1]?.end ?? 0;
}

function parseSegments(raw: unknown): ParsedSegment[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const segments: ParsedSegment[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item["text"] !== "string") continue;
    const speaker = item["speaker"];
    segments.push({
      text: item["text"],
      ...(typeof item["end"] === "number" && { end: item["end"] }),
      ...(typeof speaker === "number" && { speaker_id: `speaker_${String(speaker)}` }),
    });
  }
  return segments.length === 0 ? undefined : segments;
}

/**
 * Null rather than an empty list when the provider returned no word timing, so
 * the caller falls through to the plain result instead of promising a
 * `DetailedTranscriptionResult` with nothing in it.
 */
function parseWords(raw: unknown): WordTimestamp[] | null {
  if (!Array.isArray(raw)) return null;
  const words: WordTimestamp[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const { word, start, end } = item;
    if (typeof word !== "string" || typeof start !== "number" || typeof end !== "number") continue;
    words.push({ word: word.trim(), start, end });
  }
  return words.length === 0 ? null : words;
}
