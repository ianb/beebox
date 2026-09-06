/**
 * Audio transcription — dispatches to Whisper, Voxtral, or Deepgram based on
 * box config.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { transcribeAudioVoxtral } from "./voxtral.js";
import { transcribeAudioDeepgram } from "./deepgram.js";
import { transcribeAudioFake } from "./fake.js";
import { withCardLock } from "../../lib/card-lock.js";
import { errnoCode } from "../../lib/error-guards.js";
import { getOpenAiThinkingKey } from "../openai-thinking-key.js";
import { transcribeAudioWhisper } from "./whisper.js";
import { getMistralApiKey } from "../mistral-key.js";
import { routeVia } from "../openrouter.js";
import { transcribeAudioOpenRouter } from "./openrouter.js";


export interface TranscriptionResult {
  text: string;
  duration: number;
  language: string;
  /**
   * True when the service ran diarization AND returned speaker-labeled
   * segments. False/absent for non-diarized passes or when diarization
   * was requested but produced no usable speaker ids (e.g. mono speaker).
   */
  diarized?: boolean;
  /**
   * The actually-resolved service name that produced this result
   * (retranscription-in-chat plan, Track 2) — set only by
   * {@link transcribeAudioHq}, which is the one caller that can resolve
   * "box default" to a concrete name. The batch `transcribeAudio` dispatch
   * and the individual per-service functions leave it unset.
   */
  service?: string;
}

export interface WordTimestamp {
  word: string;
  start: number;  // seconds
  end: number;    // seconds
  /**
   * Per-word acoustic confidence (0–1), when the backend reports one.
   * Only Deepgram does; absent means "no confidence data backs this
   * word" — not "confident" and not "low confidence".
   */
  confidence?: number;
}

export interface DetailedTranscriptionResult extends TranscriptionResult {
  words: WordTimestamp[];
}

export interface TranscriptionOptions {
  wordTimestamps?: boolean;
}

export interface TranscriptionError extends Error {
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

export const TRANSCRIPTION_SERVICES = ["whisper", "voxtral", "deepgram", "openai-realtime", "fake"] as const;
export type TranscriptionService = (typeof TRANSCRIPTION_SERVICES)[number];
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
export const HQ_TRANSCRIPTION_SERVICES = ["whisper", "whisper-llm", "whisper-llm-mini", "voxtral", "voxtral-diarized"] as const;
export type HqTranscriptionService = (typeof HQ_TRANSCRIPTION_SERVICES)[number];

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

const storedTranscriptionConfigSchema = z.object({
  service: z.enum(TRANSCRIPTION_SERVICES).optional(),
  hqService: z.enum(HQ_TRANSCRIPTION_SERVICES).optional(),
});
type StoredTranscriptionConfig = z.infer<typeof storedTranscriptionConfigSchema>;

export async function loadTranscriptionConfig(boxRoot?: string): Promise<TranscriptionConfig> {
  const defaults: TranscriptionConfig = { service: "voxtral", hqService: "whisper" };
  if (!boxRoot) return defaults;
  const configPath = path.join(boxRoot, "_config/transcription.json");
  let content: string;
  try {
    content = await fs.readFile(configPath, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return defaults;
    // Permissions / I/O failures are not the same as "no config" — surface
    // them rather than silently returning defaults.
    throw e;
  }
  // JSON parse / schema errors are real bugs (corrupted config); let them bubble.
  const stored = storedTranscriptionConfigSchema.parse(JSON.parse(content));
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
  const configPath = path.join(boxRoot, "_config/transcription.json");
  // Serialize the read-merge-write so concurrent setService/setHqService
  // updates can't both read the old config and drop one's change.
  return withCardLock(configPath, async () => {
    let current: StoredTranscriptionConfig = {};
    let content: string | null = null;
    try {
      content = await fs.readFile(configPath, "utf-8");
    } catch (e) {
      if (errnoCode(e) !== "ENOENT") throw e;
      // No file yet — start fresh.
    }
    if (content !== null) {
      // Parse / schema errors are a real bug — let them bubble rather than
      // silently overwriting a corrupted config.
      current = storedTranscriptionConfigSchema.parse(JSON.parse(content));
    }
    const merged: StoredTranscriptionConfig = { ...current, ...updates };
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(merged, null, 2) + "\n");
    return loadTranscriptionConfig(boxRoot);
  });
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
  if (config.service === "fake") {
    return transcribeAudioFake(params);
  }
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
 * realtime-only), unless the caller picks a service explicitly
 * (`bbx chat retranscribe --service ...`). Same shape as `transcribeAudio`
 * so callers can use either interchangeably; this just routes by service.
 */
export async function transcribeAudioHq(
  params: TranscribeAudioParams,
  overrides?: { service?: HqTranscriptionService | undefined }
): Promise<TranscriptionResult | DetailedTranscriptionResult> {
  const service = overrides?.service ?? (await loadTranscriptionConfig(params.boxRoot)).hqService;
  const result = await dispatchHqTranscription(params, service);
  // Stamp the resolved name on the result — the one place that knows it,
  // since callers only ever pass in the unresolved `overrides?.service`.
  return { ...result, service };
}

/**
 * The provider key each HQ service would use if the box has one. Consulted
 * only to decide the ROUTE — when it comes back null and the box has an
 * OpenRouter key, the same model is reached through OpenRouter instead
 * (`core/openrouter.ts`); when it comes back non-null the direct arm resolves
 * it again for itself, which keeps each arm's own error and legacy handling
 * where it already lives.
 *
 * Only the HQ pass gets this fallback. `transcribeAudio` can carry a
 * context-biasing prompt that OpenRouter's transcription request cannot
 * express, so it stays on the direct arms.
 */
async function hqDirectKey(
  params: TranscribeAudioParams,
  service: HqTranscriptionService,
): Promise<string | null> {
  return service === "voxtral" || service === "voxtral-diarized"
    ? getMistralApiKey(params.boxRoot, { observe: false })
    : getOpenAiThinkingKey(params.boxRoot, { observe: false });
}

async function dispatchHqTranscription(
  params: TranscribeAudioParams,
  service: HqTranscriptionService,
): Promise<TranscriptionResult | DetailedTranscriptionResult> {
  const route = await routeVia({
    boxRoot: params.boxRoot,
    purpose: "transcription",
    directKey: await hqDirectKey(params, service),
  });
  if (route?.via === "openrouter") {
    return transcribeAudioOpenRouter(route.apiKey, { ...params, service });
  }
  if (service === "voxtral") {
    return transcribeAudioVoxtral(params);
  }
  if (service === "voxtral-diarized") {
    return transcribeAudioVoxtral(params, { diarization: true });
  }
  return transcribeAudioWhisper(params, { variant: service });
}
