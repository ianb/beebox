/**
 * OpenAI Audio service — typed interface for text-to-speech.
 *
 * Real implementation calls the OpenAI REST API.
 * Fake records calls and returns placeholder responses.
 */

import ky from "ky";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TTSResult {
  /** Audio data as a Buffer or ReadableStream */
  audio: Buffer;
  contentType: string;
}

// ─── Service interface ───────────────────────────────────────────────────────

export interface OpenAIAudioService {
  textToSpeech(text: string, opts?: {
    voice?: string;
    instructions?: string;
  }): Promise<TTSResult>;
}

// ─── Real implementation ─────────────────────────────────────────────────────

export function createOpenAIAudioService(apiKey: string): OpenAIAudioService {
  const api = ky.create({
    prefixUrl: "https://api.openai.com/v1",
    headers: { Authorization: `Bearer ${apiKey}` },
    retry: 2,
    timeout: 60_000,
  });

  return {
    async textToSpeech(text, opts) {
      const res = await api.post("audio/speech", {
        json: {
          model: "gpt-4o-mini-tts-2025-03-20",
          input: text,
          voice: opts?.voice ?? "alloy",
          response_format: "mp3",
          instructions: opts?.instructions ?? "Fast and concise, but with a friendly lilting tone.",
        },
      });

      const arrayBuffer = await res.arrayBuffer();
      return { audio: Buffer.from(arrayBuffer), contentType: "audio/mpeg" };
    },
  };
}

// ─── Fake implementation ─────────────────────────────────────────────────────

export interface FakeOpenAIAudioService extends OpenAIAudioService {
  /** TTS calls recorded */
  speeches: Array<{ text: string; voice?: string; instructions?: string }>;
}

export function createFakeOpenAIAudio(): FakeOpenAIAudioService {
  const fake: FakeOpenAIAudioService = {
    speeches: [],

    async textToSpeech(text, callOpts) {
      const entry: { text: string; voice?: string; instructions?: string } = { text };
      if (callOpts?.voice) entry.voice = callOpts.voice;
      if (callOpts?.instructions) entry.instructions = callOpts.instructions;
      fake.speeches.push(entry);
      // Return a minimal valid MP3 frame (silence)
      return {
        audio: Buffer.from([0xFF, 0xFB, 0x90, 0x00]),
        contentType: "audio/mpeg",
      };
    },
  };

  return fake;
}
