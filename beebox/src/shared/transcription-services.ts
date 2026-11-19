/**
 * The transcription-service vocabulary — the closed sets of service names a
 * box may configure, and the one place they are written down.
 *
 * Extracted to `shared/` (from `core/transcription/index.ts`) after the same
 * lists had drifted into three hand-maintained copies: the engine's, the tRPC
 * router's input schema, and the frontend picker's union. Adding `mai` to the
 * engine left the other two silently disagreeing, which is exactly the failure
 * the closed set is supposed to prevent — the router would have rejected a
 * value the engine accepts. Same reasoning, and the same shape, as
 * `shared/voice-models.ts`.
 *
 * Only the vocabulary lives here — no engine imports — so the frontend picker
 * can use the runtime arrays without pulling the dispatcher into the bundle.
 * The dispatch itself stays in `core/transcription/index.ts`.
 */

import { invariant } from "./invariant.js";

/**
 * The realtime / batch service, used by live dictation and `transcribeAudio`.
 * Streaming-capable values are `voxtral`, `deepgram`, and `openai-realtime`;
 * the non-streaming `whisper` falls back to voxtral on the realtime path, and
 * `openai-realtime` falls back to classic whisper for batch calls.
 */
export const TRANSCRIPTION_SERVICES = ["whisper", "voxtral", "deepgram", "openai-realtime", "fake"] as const;
export type TranscriptionService = (typeof TRANSCRIPTION_SERVICES)[number];

/**
 * One limit on how much audio a single HQ request may carry, on one route
 * (`plan:transcription-length-limits`). A limit is either a duration or an
 * upload size, whichever the provider or the measurement actually states;
 * the HQ job converts each to seconds of 16 kHz mono WAV and cuts pieces at
 * the smallest (`core/voice-recording/hq-job/pieces.ts`, `hqPieceSeconds`).
 * `source` is where the figure comes from: a doc URL or a dated measurement.
 */
export type HqLengthLimit =
  | { kind: "seconds"; maxSeconds: number; route: string; source: string }
  | { kind: "file-bytes"; maxFileBytes: number; route: string; source: string };

const OPENROUTER_JSON_BODY: HqLengthLimit = {
  kind: "seconds",
  maxSeconds: 300,
  route: "OpenRouter, base64 WAV in a JSON body",
  source:
    "Measured 2026-09-10 with mai-diarized (plan:resilient-voice-recording, incident): 600 s of WAV "
    + "(25.6 MB JSON) rejected with 400, ~6 min (~15 MB JSON) accepted. The binding limit is the body size. "
    + "300 s (12.8 MB JSON) is the policy in production since. https://openrouter.ai/docs/guides/overview/multimodal/stt "
    + "(read 2026-11-18): \"Multipart uploads are limited to 25 MB\"; \"On other providers, base64 JSON past the "
    + "multipart cap is rejected\" (OpenAI and Groq excepted); \"The upstream provider timeout is 60 seconds\".",
};

const OPENAI_DIRECT_UPLOAD: HqLengthLimit = {
  kind: "file-bytes",
  maxFileBytes: 25_000_000,
  route: "OpenAI direct, multipart",
  source: "https://developers.openai.com/api/docs/guides/speech-to-text — \"File uploads are currently limited to 25 MB\".",
};

const MAI_DIARIZATION: HqLengthLimit = {
  kind: "seconds",
  maxSeconds: 900,
  route: "MAI-Transcribe-2 diarization",
  source:
    "https://learn.microsoft.com/en-us/azure/ai-services/speech-service/mai-transcribe said in 2026-09 that diarized "
    + "requests \"fail for recordings of about 15 minutes and longer\" (plan:resilient-voice-recording, Prior art). "
    + "Read 2026-11-18: the page still says diarization \"Supports shorter recordings than transcription without "
    + "diarization; see the note that follows this table\", but the note is gone, and the REST reference gives only "
    + "the undiarized limit (\"shorter than 2 hours\", \"smaller than 250 MB\"). Unmeasured: the OpenRouter body "
    + "limit stops a 15-minute WAV first, so this limit never binds today.",
};

const MISTRAL_DURATION: HqLengthLimit = {
  kind: "seconds",
  maxSeconds: 3_600,
  route: "Mistral direct",
  source:
    "https://docs.mistral.ai/resources/known-limitations — \"Maximum audio duration: 60 minutes\" (no model named; "
    + "the legacy Voxtral Mini Transcribe 2 page says 3 hours). Measured 2026-11-18 with voxtral-mini-latest: "
    + "60 min succeeds diarized, word-timed, and plain; 75 and 90 min succeed diarized; 30, 60, and 90 min "
    + "also saw intermittent 429 backend_out_of_capacity that cleared on a later try; 175 min refused 4 of 4 "
    + "(plan:transcription-length-limits). 3600 s is the planning cap.",
};

const MISTRAL_UPLOAD: HqLengthLimit = {
  kind: "file-bytes",
  maxFileBytes: 500_000_000,
  route: "Mistral direct",
  source: "https://docs.mistral.ai/resources/known-limitations — \"Maximum file size: 500 MB\".",
};

/**
 * The narration-mode HQ checkpoint pass — non-streaming services only.
 *
 * - `whisper`: OpenAI's classic `whisper-1`. The default, and the only variant
 *   here that returns word timings.
 * - `whisper-llm` / `whisper-llm-mini`: OpenAI's LLM audio models
 *   (`gpt-4o-transcribe`, `gpt-4o-mini-transcribe`) — text only, no duration,
 *   language, or timestamps.
 * - `voxtral`: Mistral's Voxtral non-streaming model.
 * - `voxtral-diarized`: Voxtral with diarization on — output is
 *   speaker-prefixed lines ("Speaker 0: …\nSpeaker 1: …").
 * - `mai`: Microsoft's MAI-Transcribe-2, over OpenRouter only.
 * - `mai-diarized`: the same model with speaker labels, in the same
 *   speaker-prefixed shape `voxtral-diarized` produces.
 *
 * `lengthLimits` lists the limits on every route the service can take. The
 * Whisper family goes direct or through OpenRouter, chosen per call by which
 * key the box holds, so both routes' limits apply and the smaller binds.
 */
export const HQ_SERVICE_DEFINITIONS = [
  { id: "whisper", lengthLimits: [OPENAI_DIRECT_UPLOAD, OPENROUTER_JSON_BODY] },
  { id: "whisper-llm", lengthLimits: [OPENAI_DIRECT_UPLOAD, OPENROUTER_JSON_BODY] },
  { id: "whisper-llm-mini", lengthLimits: [OPENAI_DIRECT_UPLOAD, OPENROUTER_JSON_BODY] },
  { id: "voxtral", lengthLimits: [MISTRAL_DURATION, MISTRAL_UPLOAD] },
  { id: "voxtral-diarized", lengthLimits: [MISTRAL_DURATION, MISTRAL_UPLOAD] },
  { id: "mai", lengthLimits: [OPENROUTER_JSON_BODY] },
  { id: "mai-diarized", lengthLimits: [OPENROUTER_JSON_BODY, MAI_DIARIZATION] },
] as const satisfies readonly { id: string; lengthLimits: readonly [HqLengthLimit, ...HqLengthLimit[]] }[];

export type HqTranscriptionService = (typeof HQ_SERVICE_DEFINITIONS)[number]["id"];
export const HQ_TRANSCRIPTION_SERVICES = HQ_SERVICE_DEFINITIONS.map((definition) => definition.id);

/** The length limits for one HQ service. */
export function hqLengthLimits(service: HqTranscriptionService): readonly HqLengthLimit[] {
  const definition = HQ_SERVICE_DEFINITIONS.find((d) => d.id === service);
  invariant(definition !== undefined, `no definition for HQ service ${service}`);
  return definition.lengthLimits;
}

/**
 * The HQ services served by Microsoft's MAI-Transcribe-2, which the box can
 * reach ONLY through OpenRouter — it holds no Azure credential and the model is
 * served nowhere else we call.
 */
export type MaiHqService = "mai" | "mai-diarized";

export function isMaiHqService(service: HqTranscriptionService): service is MaiHqService {
  return service === "mai" || service === "mai-diarized";
}

/**
 * The HQ services that label speakers. A native client keeps the HQ pass on
 * the box for these instead of transcribing on the device, because Apple's
 * on-device model cannot separate speakers (mobile contract §4.4a).
 */
export function isDiarizedHqService(service: HqTranscriptionService): boolean {
  return service === "voxtral-diarized" || service === "mai-diarized";
}
