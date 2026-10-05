/**
 * Text-to-speech — the service the chat voice speaks through, as one interface
 * with a real implementation per backend and a fake.
 *
 * **This interface existed before this file did, and nothing called it.**
 * `createOpenAIAudioService` was declared, used by tests, and never constructed
 * in `src/`; the live path was an inline `ky.post` in the TTS route's fallback
 * branch. Adding a second backend to that branch would have made two dead
 * abstractions and one live if-ladder, so the seam was made real first
 * (`docs/plans/tts-backend-selection.md`, Track 1).
 *
 * A backend is chosen by the box (`core/tts/config.ts`), not by a key: granting
 * an OpenRouter key must never change what the box sounds like.
 */

import ky, { type RetryOptions } from "ky";
import { collectInteractionAudio, InteractionStreamError } from "../core/tts/interaction-stream.js";
import { deliverStyle } from "../core/tts/style.js";
import { resolveVoice } from "../core/tts/voices.js";
import { pcmToWav } from "../core/tts/wav.js";
import { DEFAULT_TTS_INSTRUCTIONS, type TtsBackend } from "../shared/tts-backends.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TTSResult {
  /** Audio data as a Buffer or ReadableStream */
  audio: Buffer;
  contentType: string;
}

/**
 * Below this, a "successful" response is not audio. Gemini has been observed
 * answering HTTP 200 with a zero-length body; a buffer that short reaches the
 * browser as silence the boxholder blames on their speakers, so it is an error
 * here rather than a result (principle 4, never silent).
 */
const MIN_PLAUSIBLE_AUDIO_BYTES = 512;

/** A backend returned a 200 that cannot be audio. */
export class EmptyTtsResponseError extends Error {
  constructor({ backend, bytes }: { backend: TtsBackend; bytes: number }) {
    super(`TTS backend "${backend}" returned ${String(bytes)} bytes — too short to be speech`);
    this.name = "EmptyTtsResponseError";
  }
}

// ─── Service interface ───────────────────────────────────────────────────────

export interface TtsService {
  readonly backend: TtsBackend;
  /**
   * Whether this backend can act on style direction at all. False means the
   * boxholder's `instructions` reach nothing — the UI says so rather than
   * letting a personality card carry a setting with no effect.
   */
  readonly stylable: boolean;
  textToSpeech(text: string, opts?: {
    voice?: string;
    instructions?: string;
  }): Promise<TTSResult>;
}

// ─── Real implementations ────────────────────────────────────────────────────

/**
 * Pick the voice this backend can serve. A `mapped` result is silent on
 * purpose — it is the boxholder's own chosen equivalent, not a degradation —
 * while a `substituted` one names what was lost, because nobody asked for it.
 */
function voiceFor(backend: TtsBackend, requested: string | undefined): string {
  const choice = resolveVoice({ backend, requested });
  if (choice.kind === "substituted") {
    console.warn(
      `[tts] backend "${backend}" has no voice "${choice.requested}" and no mapping for it — speaking as `
        + `"${choice.voice}". Add a mapping in core/tts/voices.ts, or pick a voice this backend offers.`,
    );
  }
  return choice.voice;
}

function assertPlayable(audio: Buffer, backend: TtsBackend): Buffer {
  if (audio.length < MIN_PLAUSIBLE_AUDIO_BYTES) {
    throw new EmptyTtsResponseError({ backend, bytes: audio.length });
  }
  return audio;
}

/**
 * Per-attempt budget, and a retry policy that actually applies to these calls.
 *
 * `retry: 2` did nothing here: ky excludes POST from `retry.methods` by default
 * and sets `retryOnTimeout: false`, so both of the failures these endpoints
 * actually produce — a provider 502 and a stalled request — were single
 * attempts. OpenRouter documents 502/503/524/529 as transient and tells callers
 * to retry them, so the shorter per-attempt budget buys three chances inside
 * roughly the wall-clock one 60s attempt used to take.
 */
const TTS_ATTEMPT_MS = 30_000;
const TTS_RETRY = {
  limit: 2,
  methods: ["post"],
  // ky's defaults plus OpenRouter's own transient codes (524 infrastructure
  // timeout, 529 provider overloaded), which it does not know about.
  statusCodes: [408, 429, 500, 502, 503, 504, 524, 529],
  retryOnTimeout: true,
} satisfies RetryOptions;

/** OpenAI's speech endpoint, which takes style direction in its own `instructions` field. */
function createOpenAiTts(apiKey: string, fetchImpl: typeof fetch | undefined): TtsService {
  const api = ky.create({
    prefixUrl: "https://api.openai.com/v1",
    headers: { Authorization: `Bearer ${apiKey}` },
    retry: TTS_RETRY,
    timeout: TTS_ATTEMPT_MS,
    ...(fetchImpl !== undefined && { fetch: fetchImpl }),
  });

  return {
    backend: "openai",
    stylable: true,
    async textToSpeech(text, opts) {
      const style = deliverStyle({ backend: "openai", instructions: opts?.instructions ?? DEFAULT_TTS_INSTRUCTIONS });
      const res = await api.post("audio/speech", {
        json: {
          model: "gpt-4o-mini-tts-2025-03-20",
          input: text,
          voice: voiceFor("openai", opts?.voice),
          response_format: "mp3",
          ...(style.kind === "field" && { instructions: style.instructions }),
        },
      });
      const audio = Buffer.from(await res.arrayBuffer());
      return { audio: assertPlayable(audio, "openai"), contentType: "audio/mpeg" };
    },
  };
}

/**
 * The Gemini speech model. Flash-Lite rather than Flash: same voices and style
 * handling at two-thirds the audio price, and the 2026-10-04 benchmark
 * (`docs/plans/tts-backend-selection.md`) heard no reason to pay more for chat
 * replies.
 */
const GEMINI_TTS_MODEL = "gemini-3.8-flash-lite-tts";
const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/**
 * The whole-call budget for a streamed request. ky's `timeout` covers only the
 * wait for response headers, so a stream that stalls after them would
 * otherwise hang the reply forever. Three attempts' worth, matching what the
 * retried unary calls can take.
 */
const GEMINI_STREAM_DEADLINE_MS = TTS_ATTEMPT_MS * 3;

/**
 * Gemini on Google's own Interactions API, with the box's `gemini` key — the
 * only route. OpenRouter also serves this model, but cannot carry style
 * direction to it, and 3.8 reads direction placed in the text aloud, so that
 * route lost the boxholder's speaking style without a sound to show for it
 * (`core/tts/resolve.ts`).
 *
 * Style rides in a `speech_metadata` annotation, the field 3.8 reads it from.
 * Streamed and buffered, because that finishes about a third sooner than the
 * unary call (`core/tts/interaction-stream.ts`). `store: false` because the
 * API otherwise keeps every request server-side (55 days on the paid tier) to
 * support follow-up turns speech never makes. Output is raw 24 kHz PCM,
 * wrapped as WAV here rather than transcoded.
 */
function createGeminiTts(apiKey: string, fetchImpl: typeof fetch | undefined): TtsService {
  return {
    backend: "gemini",
    stylable: true,
    async textToSpeech(text, opts) {
      const style = deliverStyle({ backend: "gemini", instructions: opts?.instructions ?? DEFAULT_TTS_INSTRUCTIONS });
      const deadline = AbortSignal.timeout(GEMINI_STREAM_DEADLINE_MS);
      let pcm: Buffer;
      try {
        const res = await ky.post("interactions", {
          prefixUrl: GEMINI_API_BASE_URL,
          headers: { "x-goog-api-key": apiKey },
          retry: TTS_RETRY,
          timeout: TTS_ATTEMPT_MS,
          signal: deadline,
          ...(fetchImpl !== undefined && { fetch: fetchImpl }),
          json: {
            model: GEMINI_TTS_MODEL,
            stream: true,
            store: false,
            input: [{
              type: "user_input",
              content: [{
                type: "text",
                text,
                ...(style.kind === "field" && {
                  annotations: [{ type: "speech_metadata", style: style.instructions }],
                }),
              }],
            }],
            generation_config: { speech_config: [{ voice: voiceFor("gemini", opts?.voice) }] },
          },
        });
        pcm = res.body === null ? Buffer.alloc(0) : await collectInteractionAudio(res.body);
      } catch (e) {
        if (deadline.aborted) {
          throw new InteractionStreamError({ kind: "deadline", seconds: GEMINI_STREAM_DEADLINE_MS / 1000 }, { cause: e });
        }
        throw e;
      }
      assertPlayable(pcm, "gemini");
      return { audio: pcmToWav(pcm), contentType: "audio/wav" };
    },
  };
}

/**
 * Build the service for a chosen backend and its credential. There is no route
 * to choose: each backend lives at exactly one host, and `core/tts/resolve.ts`
 * records why passing a `ModelRoute` here was actively wrong. `fetch` is the
 * test seam for the HTTP calls.
 */
export function createTtsService(
  { backend, apiKey, fetch: fetchImpl }: { backend: TtsBackend; apiKey: string; fetch?: typeof fetch },
): TtsService {
  switch (backend) {
    case "openai":
      return createOpenAiTts(apiKey, fetchImpl);
    case "gemini":
      return createGeminiTts(apiKey, fetchImpl);
  }
}

// ─── Fake implementation ─────────────────────────────────────────────────────

export interface FakeTtsService extends TtsService {
  /** TTS calls recorded */
  speeches: Array<{ text: string; voice?: string; instructions?: string }>;
}

/**
 * `emptyResponse` makes the fake return a genuinely zero-length buffer rather
 * than a flag meaning "pretend it was empty" — a mock written by the bug's
 * author encodes the bug, so the guard is asserted against the real shape.
 */
export function createFakeTts(opts?: {
  backend?: TtsBackend;
  stylable?: boolean;
  emptyResponse?: boolean;
  /** Lets a test assert that a WAV-returning backend's label reaches the browser. */
  contentType?: string;
}): FakeTtsService {
  const speeches: Array<{ text: string; voice?: string; instructions?: string }> = [];
  const backend = opts?.backend ?? "openai";
  return {
    backend,
    stylable: opts?.stylable ?? true,
    speeches,
    async textToSpeech(text, callOpts) {
      speeches.push({
        text,
        ...(callOpts?.voice !== undefined && { voice: callOpts.voice }),
        ...(callOpts?.instructions !== undefined && { instructions: callOpts.instructions }),
      });
      const audio = opts?.emptyResponse === true
        ? Buffer.alloc(0)
        // A minimal MP3 frame header — enough to be a plausible buffer.
        : Buffer.concat([Buffer.from([0xFF, 0xFB, 0x90, 0x00]), Buffer.alloc(MIN_PLAUSIBLE_AUDIO_BYTES)]);
      return Promise.resolve({ audio: assertPlayable(audio, backend), contentType: opts?.contentType ?? "audio/mpeg" });
    },
  };
}
