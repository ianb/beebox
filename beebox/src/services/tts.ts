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

import ky from "ky";
import { OPENROUTER_BASE_URL, openRouterProvider } from "../core/openrouter.js";
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
 * Pick the voice this backend can serve, saying so when the boxholder's choice
 * is not one of them. Warned once per call rather than latched: the substituted
 * voice changes with the personality card, so a latch would hide the second
 * one.
 */
function voiceFor(backend: TtsBackend, requested: string | undefined): string {
  const choice = resolveVoice({ backend, requested });
  if (choice.kind === "substituted") {
    console.warn(
      `[tts] backend "${backend}" has no voice "${choice.requested}" — speaking as "${choice.voice}". `
        + "Pick a voice this backend offers, or switch backends.",
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

/** OpenAI's speech endpoint — the only backend with a dedicated style field. */
function createOpenAiTts(apiKey: string): TtsService {
  const api = ky.create({
    prefixUrl: "https://api.openai.com/v1",
    headers: { Authorization: `Bearer ${apiKey}` },
    retry: 2,
    timeout: 60_000,
  });

  return {
    backend: "openai",
    stylable: true,
    async textToSpeech(text, opts) {
      const style = deliverStyle({
        backend: "openai",
        text,
        instructions: opts?.instructions ?? DEFAULT_TTS_INSTRUCTIONS,
      });
      const res = await api.post("audio/speech", {
        json: {
          model: "gpt-4o-mini-tts-2025-03-20",
          input: style.kind === "prefix" ? style.input : text,
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
 * Gemini through OpenRouter. Style direction goes inside `input` because
 * OpenRouter's speech request has no field for it — and is silently ignored if
 * sent, which is why `deliverStyle` owns the placement rather than this call
 * site. Output is PCM only, wrapped as WAV here rather than transcoded.
 */
function createGeminiTts(apiKey: string): TtsService {
  return {
    backend: "gemini",
    stylable: true,
    async textToSpeech(text, opts) {
      const style = deliverStyle({
        backend: "gemini",
        text,
        instructions: opts?.instructions ?? DEFAULT_TTS_INSTRUCTIONS,
      });
      const res = await ky.post("audio/speech", {
        prefixUrl: OPENROUTER_BASE_URL,
        headers: { Authorization: `Bearer ${apiKey}` },
        retry: 2,
        timeout: 60_000,
        json: {
          model: "google/gemini-3.1-flash-tts-preview",
          provider: openRouterProvider("google-ai-studio"),
          input: style.kind === "prefix" ? style.input : text,
          voice: voiceFor("gemini", opts?.voice),
          response_format: "pcm",
        },
      });
      const pcm = Buffer.from(await res.arrayBuffer());
      assertPlayable(pcm, "gemini");
      return { audio: pcmToWav(pcm), contentType: "audio/wav" };
    },
  };
}

/**
 * Build the service for a chosen backend and its credential. There is no route
 * to choose: each backend lives at exactly one host, and `core/tts/resolve.ts`
 * records why passing a `ModelRoute` here was actively wrong.
 */
export function createTtsService({ backend, apiKey }: { backend: TtsBackend; apiKey: string }): TtsService {
  switch (backend) {
    case "openai":
      return createOpenAiTts(apiKey);
    case "gemini":
      return createGeminiTts(apiKey);
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
