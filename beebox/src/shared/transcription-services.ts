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

/**
 * The realtime / batch service, used by live dictation and `transcribeAudio`.
 * Streaming-capable values are `voxtral`, `deepgram`, and `openai-realtime`;
 * the non-streaming `whisper` falls back to voxtral on the realtime path, and
 * `openai-realtime` falls back to classic whisper for batch calls.
 */
export const TRANSCRIPTION_SERVICES = ["whisper", "voxtral", "deepgram", "openai-realtime", "fake"] as const;
export type TranscriptionService = (typeof TRANSCRIPTION_SERVICES)[number];

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
 */
export const HQ_TRANSCRIPTION_SERVICES = [
  "whisper", "whisper-llm", "whisper-llm-mini", "voxtral", "voxtral-diarized", "mai", "mai-diarized",
] as const;
export type HqTranscriptionService = (typeof HQ_TRANSCRIPTION_SERVICES)[number];

/**
 * The HQ services served by Microsoft's MAI-Transcribe-2, which the box can
 * reach ONLY through OpenRouter — it holds no Azure credential and the model is
 * served nowhere else we call.
 */
export type MaiHqService = "mai" | "mai-diarized";

export function isMaiHqService(service: HqTranscriptionService): service is MaiHqService {
  return service === "mai" || service === "mai-diarized";
}
