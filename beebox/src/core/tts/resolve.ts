/**
 * Turn a box's TTS config into a service that can actually speak, or say why
 * it cannot.
 *
 * **Each key goes only to its own host.** OpenAI speech exists at one host, so
 * its backend takes the `openai-thinking` key or nothing. Using `routeVia`
 * there was a real bug caught end-to-end: with no `openai-thinking` key it
 * happily returned the box's OpenRouter credential, which `createOpenAiTts`
 * then sent to `api.openai.com` for a 401. There is no OpenAI TTS model on
 * OpenRouter to fall back to.
 *
 * Gemini speech does exist at two hosts, so it routes the way embeddings and
 * Whisper do: `routeVia` with the `gemini` key as the direct arm, OpenRouter
 * otherwise, and the `ModelRoute` it returns carries the key together with the
 * host it belongs to. **The direct key wins when both are granted**, and the
 * OpenRouter key then catches only direct rate-limit overflow. Same
 * model and price on both routes, but only the direct route applies speaking
 * style (`style.ts`), and it streams, which finished sooner than OpenRouter at
 * every length in the 2026-10-04 benchmark
 * (`docs/plans/tts-backend-selection.md`).
 */

import { getGeminiApiKey } from "../gemini-key.js";
import { getOpenAiThinkingKey } from "../openai-thinking-key.js";
import { getOpenRouterKey, routeVia } from "../openrouter.js";
import { createTtsService, type TtsService } from "../../services/tts.js";
import type { TtsBackend } from "../../shared/tts-backends.js";
import { loadTtsConfig } from "./config.js";

/** The access-log label for every key this module spends. */
const SPEECH_PURPOSE = "speech";

/** No credential reaches the configured backend. Names the fix, not the symptom. */
export class TtsNotConfiguredError extends Error {
  constructor({ backend }: { backend: TtsBackend }) {
    super(
      backend === "gemini"
        ? 'TTS backend "gemini" needs a Google AI Studio key or an OpenRouter key. '
          + 'Grant the "gemini" secret (preferred: speaking style works only there) or the "openrouter" '
          + "secret to this box, or choose a different TTS backend."
        : 'TTS backend "openai" needs an OpenAI key — OpenRouter carries no OpenAI speech model, '
          + 'so it cannot stand in. Grant the "openai-thinking" secret to this box, or choose a '
          + "different TTS backend.",
    );
    this.name = "TtsNotConfiguredError";
  }
}

export async function resolveTtsService(boxRoot: string): Promise<TtsService> {
  const { backend } = await loadTtsConfig(boxRoot);
  switch (backend) {
    case "openai": {
      const apiKey = await getOpenAiThinkingKey(boxRoot, { observe: true });
      if (apiKey === null || apiKey === "") throw new TtsNotConfiguredError({ backend });
      return createTtsService({ backend, apiKey });
    }
    case "gemini": {
      const route = await routeVia({
        boxRoot,
        purpose: SPEECH_PURPOSE,
        directKey: await getGeminiApiKey(boxRoot, { purpose: SPEECH_PURPOSE, observe: true }),
        observe: true,
      });
      if (route === null || route.apiKey === "") throw new TtsNotConfiguredError({ backend });
      if (route.via === "openrouter") return createTtsService({ backend, route });
      // Resolved only on a direct 429 (`services/tts.ts`), so the key is
      // observed as spent only when it was.
      const overflow = (): Promise<string | null> => getOpenRouterKey(boxRoot, { purpose: SPEECH_PURPOSE, observe: true });
      return createTtsService({ backend, route, overflow });
    }
  }
}
