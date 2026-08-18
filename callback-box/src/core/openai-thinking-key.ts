/**
 * Resolve the box's OpenAI *thinking* key — the one behind chat TTS, Whisper
 * transcription, and the realtime client-secret mint.
 *
 * Migrated onto the machine-level secret store following `mistral-key.ts`
 * (`docs/plans/secret-custody.md`, Track 3). Order:
 *
 * 1. **The store**, name `openai-thinking`, at `server` access.
 * 2. **`THINKING_OPENAI_API_KEY`** — the env path this key has always had.
 *
 * There is NO legacy per-box file arm: this key has only ever been an env var,
 * and `openai.secret.json` belongs to the *other* OpenAI name (`openai` —
 * embeddings and the `/api/adapters/openai` pass-through, see
 * `core/search/embeddings-key.ts`). The two names stay distinct in the store
 * for the reason they were distinct before it: a transcription key is not
 * consent to pay for embeddings, and boxes may hold different keys for each.
 */

import { resolveSecret } from "./secrets/resolve.js";

/** The store name this key lives under. */
export const OPENAI_THINKING_SECRET_NAME = "openai-thinking";

export async function getOpenAiThinkingKey(boxRoot?: string): Promise<string | null> {
  if (boxRoot !== undefined) {
    const resolved = await resolveSecret({
      boxRoot,
      name: OPENAI_THINKING_SECRET_NAME,
      purpose: "openai-audio",
      access: "server",
    });
    if (resolved.ok) {
      if (resolved.value.suspect) {
        console.warn("[openai-thinking-key] the stored OpenAI key last failed a probe — it may be expired.");
      }
      return resolved.value.value;
    }
    // Refusals degrade to the env var, then to "not configured" — the same
    // surface these call sites have always presented.
  }
  return process.env["THINKING_OPENAI_API_KEY"] ?? null;
}
