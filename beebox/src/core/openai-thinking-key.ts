/**
 * Resolve the box's OpenAI *thinking* key — the one behind chat TTS, Whisper
 * transcription, and the realtime client-secret mint. The machine store's
 * `openai-thinking` entry at `server` access, and nothing else
 * (`docs/implemented-plans/secret-custody.md`); the `THINKING_OPENAI_API_KEY`
 * env path this key used to have was retired with the rest of the transition
 * window.
 *
 * The name stays distinct from `openai` — embeddings and the
 * `/api/adapters/openai` pass-through (`core/search/embeddings-key.ts`) — for
 * the reason the two were distinct before the store: a transcription key is not
 * consent to pay for embeddings, and boxes may hold different keys for each.
 *
 * `boxRoot` stays optional because `TranscribeAudioParams.boxRoot` is; with no
 * box there are no grants to check and so no key.
 */

import { resolveSecret, type SecretRead } from "./secrets/resolve.js";

/** The store name this key lives under. */
export const OPENAI_THINKING_SECRET_NAME = "openai-thinking";

export async function getOpenAiThinkingKey(boxRoot: string | undefined, read: SecretRead): Promise<string | null> {
  if (boxRoot === undefined) return null;
  const resolved = await resolveSecret({
    boxRoot,
    name: OPENAI_THINKING_SECRET_NAME,
    purpose: "openai-audio",
    access: "server",
    observe: read.observe,
  });
  if (!resolved.ok) return null;
  if (resolved.value.suspect) {
    console.warn("[openai-thinking-key] the stored OpenAI key last failed a probe — it may be expired.");
  }
  return resolved.value.value;
}
