/**
 * Load the OpenAI embeddings API key: the machine store's `openai` entry at
 * `server` access (`docs/implemented-plans/secret-custody.md`), and nothing
 * else. The transition window's in-tree `openai.secret.json` file and
 * `BBX_OPENAI_API_KEY` env var are gone, and with them the typed error that
 * reported a malformed file — a store entry is an opaque key string, so there
 * is no longer a half-configured state to report.
 *
 * `openai` is the box's GENERAL OpenAI key (embeddings, and the
 * `/api/adapters/openai` pass-through). It is deliberately distinct from
 * `openai-thinking` (`core/openai-thinking-key.ts`, behind TTS/Whisper/
 * realtime): a transcription key is not consent to pay for embeddings, and
 * that separation predates the store.
 */

import { resolveSecret } from "../secrets/resolve.js";

/** The store name this key lives under — matches the retired file's basename. */
const OPENAI_SECRET_NAME = "openai";

export async function getOpenAiEmbeddingsKey(boxRoot: string): Promise<string | null> {
  const resolved = await resolveSecret({
    boxRoot,
    name: OPENAI_SECRET_NAME,
    purpose: "embeddings",
    access: "server",
  });
  if (!resolved.ok) return null;
  if (resolved.value.suspect) {
    console.warn("[embeddings-key] the stored OpenAI key last failed a probe — it may be expired.");
  }
  return resolved.value.value;
}
