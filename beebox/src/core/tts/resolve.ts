/**
 * Turn a box's TTS config into a service that can actually speak, or say why
 * it cannot.
 *
 * **Neither backend has a fallback, and that is the whole subtlety here.** Each
 * one takes exactly one key, sent to exactly one host — unlike embeddings or
 * Whisper transcription, where `routeVia` picks between a direct arm and
 * OpenRouter. Using `routeVia` here was a real bug caught end-to-end: with no
 * `openai-thinking` key it happily returned the box's OpenRouter credential,
 * which `createOpenAiTts` then sent to `api.openai.com` for a 401.
 *
 * Gemini speech could have a second route — OpenRouter serves the same model —
 * and briefly did. It was removed on the boxholder's call (2026-10-04): Gemini
 * 3.8 reads style direction placed in the text aloud, and OpenRouter's speech
 * request has no field that carries it to the model, so that route silently
 * lost the personality card's speaking style. A regression nobody can see is
 * worse than a missing key that says so.
 */

import { getGeminiApiKey } from "../gemini-key.js";
import { getOpenAiThinkingKey } from "../openai-thinking-key.js";
import { createTtsService, type TtsService } from "../../services/tts.js";
import type { TtsBackend } from "../../shared/tts-backends.js";
import { loadTtsConfig } from "./config.js";

/** No credential reaches the configured backend. Names the fix, not the symptom. */
export class TtsNotConfiguredError extends Error {
  constructor({ backend }: { backend: TtsBackend }) {
    super(
      backend === "gemini"
        ? 'TTS backend "gemini" needs a Google AI Studio key. Grant the "gemini" secret to this box, '
          + "or choose a different TTS backend. An OpenRouter key does not stand in: through OpenRouter "
          + "the speaking style is lost."
        : 'TTS backend "openai" needs an OpenAI key — OpenRouter carries no OpenAI speech model, '
          + 'so it cannot stand in. Grant the "openai-thinking" secret to this box, or choose a '
          + "different TTS backend.",
    );
    this.name = "TtsNotConfiguredError";
  }
}

/** The one credential each backend accepts. */
async function credentialFor(backend: TtsBackend, boxRoot: string): Promise<string | null> {
  switch (backend) {
    case "openai":
      return getOpenAiThinkingKey(boxRoot, { observe: true });
    case "gemini":
      return getGeminiApiKey(boxRoot, { purpose: "speech", observe: true });
  }
}

export async function resolveTtsService(boxRoot: string): Promise<TtsService> {
  const { backend } = await loadTtsConfig(boxRoot);
  const apiKey = await credentialFor(backend, boxRoot);
  if (apiKey === null || apiKey === "") throw new TtsNotConfiguredError({ backend });
  return createTtsService({ backend, apiKey });
}
