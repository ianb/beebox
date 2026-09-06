/**
 * The HQ transcription pass over OpenRouter. Two kinds of service arrive here:
 *
 * - **The Whisper family**, which `whisper.ts` also calls directly. OpenRouter
 *   is the fallback when the box holds no `openai-thinking` key of its own
 *   (`core/openrouter.ts` decides which).
 * - **MAI-Transcribe-2** (`mai`, `mai-diarized`), which has NO direct arm — the
 *   box holds no Azure credential and the model is served nowhere else we
 *   reach — so an OpenRouter key is its requirement rather than its fallback.
 *   It is also the box's only speaker-labelling route over OpenRouter.
 *
 * **Voxtral does not route here**, and that is a measured limit rather than a
 * scoping choice. Checked against the live API on
 * 2026-09-06: `mistralai/voxtral-mini-transcribe` rejects `verbose_json` with a
 * 400 and answers `json` alone — no segments, no words, no language, and no
 * speaker labels. Mistral's `diarize` flag sent through OpenRouter's
 * provider-option passthrough changed nothing: byte-identical output and
 * identical cost, which is exactly how a silently-dropped passthrough behaves.
 * So `voxtral-diarized` over OpenRouter could not diarize at all, and plain
 * `voxtral` would quietly lose word timing and language detection. A box on
 * voxtral HQ with no Mistral key gets today's "not configured" error instead —
 * visibly unconfigured beats invisibly worse. `openai/whisper-1`, by contrast,
 * returns duration, language, and word timings identical to the direct call.
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
 * every model id below has exactly one serving provider (OpenAI), so the
 * request reaches the same company the direct call would have regardless. If a
 * second provider ever appears for one of them, that assumption is what breaks.
 */

import ky from "ky";
import { isRecord } from "../../lib/is-record.js";
import { OPENROUTER_BASE_URL } from "../openrouter.js";
import { buildDiarizedText, joinSegmentTexts, repairMissingSentenceSpaces } from "./voxtral-text.js";
import type {
  DetailedTranscriptionResult,
  TranscribeAudioParams,
  TranscriptionError,
  TranscriptionResult,
  WordTimestamp,
} from "./index.js";
import type { MaiHqService } from "./index.js";
import type { WhisperVariant } from "./whisper.js";

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

/** What one HQ service needs from OpenRouter's transcription endpoint. */
interface OpenRouterSttModel {
  model: string;
  /**
   * Whether the model answers `verbose_json`. The two LLM audio models do not —
   * the same limitation they have when called directly, where the direct arm
   * fills duration and language with empty defaults for exactly this reason.
   */
  verbose: boolean;
  /** Present when this service wants speaker labels: the options that ask for them. */
  diarize?: Record<string, unknown>;
}

/**
 * Diarization is not a normalized OpenRouter parameter, so it travels as
 * provider-specific option passthrough. Verified honored on 2026-09-06: the
 * `speaker` field comes back only when this block is sent — never with the flag
 * false, a bogus option key, or an empty options object.
 */
const AZURE_DIARIZATION = { azure: { diarization: { enabled: true } } } as const;

const OPENROUTER_STT_MODELS: Record<WhisperVariant | MaiHqService, OpenRouterSttModel> = {
  whisper: { model: "openai/whisper-1", verbose: true },
  "whisper-llm": { model: "openai/gpt-4o-transcribe", verbose: false },
  "whisper-llm-mini": { model: "openai/gpt-4o-mini-transcribe", verbose: false },
  mai: { model: "microsoft/mai-transcribe-2", verbose: true },
  "mai-diarized": { model: "microsoft/mai-transcribe-2", verbose: true, diarize: AZURE_DIARIZATION },
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
  { variant, ...params }: TranscribeAudioParams & { variant: WhisperVariant | MaiHqService },
): Promise<TranscriptionResult | DetailedTranscriptionResult> {
  const { model, verbose, diarize } = OPENROUTER_STT_MODELS[variant];
  const diarization = diarize !== undefined;
  const wordTimestamps = params.options?.wordTimestamps === true;

  if (params.prompt !== undefined && params.prompt !== "" && !warnedAboutDroppedPrompt) {
    warnedAboutDroppedPrompt = true;
    console.warn(
      "[transcription/openrouter] context-biasing prompt dropped: OpenRouter's transcription request has no " +
        "prompt/context_bias parameter. Grant this box the provider's own key to keep the bias.",
    );
  }


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
        // MAI returns segments — and so speaker labels — only when word
        // granularity is asked for, so diarization implies it.
        ...(verbose && (wordTimestamps || diarization) && { timestamp_granularities: ["word"] }),
        ...(diarize !== undefined && { provider: { options: diarize } }),
      },
    })
    .json<unknown>();

  const result = shapeOpenRouterResult(body, { diarization, wordTimestamps });
  // A provider-option passthrough the provider ignores fails silently by
  // construction, and an unlabeled transcript looks exactly like a
  // single-speaker recording. Say so rather than let the caller believe
  // diarization ran — the same guard `warnIfDiarizationUnlabeled` gives the
  // direct Voxtral arm.
  if (diarization && result.diarized !== true) {
    console.warn(
      "[transcription/openrouter] diarization requested but no speaker labels came back. Either the recording has "
        + "one speaker, or the provider did not honor the diarization option.",
    );
  }
  return result;
}

interface ParsedSegment {
  text: string;
  /** Segment end in seconds, when the provider timed it — the duration ladder's last rung. */
  end?: number;
  /**
   * Renamed from OpenRouter's numeric `speaker` so the shared
   * `buildDiarizedText` — written against Voxtral's string ids — keeps
   * producing the same "Speaker 0:" lines from either backend.
   */
  speaker_id?: string | null;
}

/**
 * Turn OpenRouter's normalized response into the shape every transcription
 * caller already handles. Mirrors the direct arms' precedence — word timestamps
 * win, then segment rejoining, then the raw text — so a box switching routes
 * sees the same transcript structure it saw before.
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
  // Empty, not "unknown", when the model did not report one: `whisper.ts` fills
  // `""` in the same case (the LLM audio variants never report a language), and
  // this value reaches a card's frontmatter — the same recording must not
  // describe itself differently depending on which key the box happens to hold.
  const language = typeof body["language"] === "string" ? body["language"] : "";
  const segments = parseSegments(body["segments"]);
  const words = parseWords(body["words"]);
  const duration = resolveDuration(body, { segments, words });

  // Word timing wins over speaker labels when both are asked for, matching
  // `shapeVoxtralResult` — two diarized services must not disagree about what
  // `--timestamps` returns. MAI could in principle serve both at once (it puts
  // a `speaker` on every word), but `WordTimestamp` has nowhere to carry one,
  // so honoring the existing precedence beats inventing a divergence here.
  if (wordTimestamps && words !== null) {
    return { text: rawText, duration, language, words } satisfies DetailedTranscriptionResult;
  }

  // Diarized output is speaker-prefixed lines, the shape `voxtral-diarized`
  // already produces, so a reader downstream cannot tell the backends apart.
  const labeledText = diarization ? buildDiarizedText(segments) : null;
  const text = labeledText ?? joinSegmentTexts(segments) ?? repairMissingSentenceSpaces(rawText);
  return { text, duration, language, ...(diarization && { diarized: labeledText !== null }) };
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
