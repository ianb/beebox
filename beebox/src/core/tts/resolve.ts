/**
 * Turn a box's TTS config into a service that can actually speak, or say why
 * it cannot.
 *
 * **Neither backend has a fallback, and that is the whole subtlety here.** Each
 * one is reachable at exactly one host, so a key is either the right key or no
 * key — unlike embeddings or Whisper transcription, where `routeVia` picks
 * between a direct arm and OpenRouter. Using `routeVia` here was a real bug
 * caught end-to-end: with no `openai-thinking` key it happily returned the
 * box's OpenRouter credential, which `createOpenAiTts` then sent to
 * `api.openai.com` for a 401. There is no OpenAI TTS model on OpenRouter to
 * fall back to in the first place.
 */

import { getOpenAiThinkingKey } from "../openai-thinking-key.js";
import { getOpenRouterKey } from "../openrouter.js";
import { createTtsService, type TtsService } from "../../services/tts.js";
import type { TtsBackend } from "../../shared/tts-backends.js";
import { loadTtsConfig } from "./config.js";

/** No credential reaches the configured backend. Names the fix, not the symptom. */
export class TtsNotConfiguredError extends Error {
  constructor({ backend }: { backend: TtsBackend }) {
    super(
      backend === "gemini"
        ? 'TTS backend "gemini" needs an OpenRouter key — it is reachable no other way. '
          + 'Grant the "openrouter" secret to this box, or choose a different TTS backend.'
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
      return getOpenRouterKey(boxRoot, { purpose: "speech", observe: true });
  }
}

export async function resolveTtsService(boxRoot: string): Promise<TtsService> {
  const { backend } = await loadTtsConfig(boxRoot);
  const apiKey = await credentialFor(backend, boxRoot);
  if (apiKey === null || apiKey === "") throw new TtsNotConfiguredError({ backend });
  return createTtsService({ backend, apiKey });
}
