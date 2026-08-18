/**
 * Resolve the box's Gemini API key — the one behind audio questions
 * (`cb chat ask-about-audio`) and scan-import's opt-in Gemini vision backend.
 *
 * This module exists to CONSOLIDATE what used to be the same two-env-var read
 * copied into four places (`core/audio-question.ts`, `services/scan-vision.ts`,
 * `cli/commands/chat-audio.ts`, `trpc/routers/health.ts`). Order
 * (`docs/plans/secret-custody.md`, Track 3):
 *
 * 1. **The store**, name `gemini`, at `server` access.
 * 2. **`GEMINI_KEY`**, then **`SKE_GEMINI_API_KEY`** — the two env vars this
 *    key has always been read from, in that order.
 *
 * No legacy per-box file arm: Gemini never had one.
 */

import { resolveSecret } from "./secrets/resolve.js";

/** The store name this key lives under. */
export const GEMINI_SECRET_NAME = "gemini";

/** The env fallbacks, in the order they have always been read. */
export function geminiKeyFromEnv(): string | null {
  return process.env["GEMINI_KEY"] || process.env["SKE_GEMINI_API_KEY"] || null;
}

export async function getGeminiApiKey(boxRoot?: string): Promise<string | null> {
  if (boxRoot !== undefined) {
    const resolved = await resolveSecret({
      boxRoot,
      name: GEMINI_SECRET_NAME,
      purpose: "gemini-vision",
      access: "server",
    });
    if (resolved.ok) {
      if (resolved.value.suspect) {
        console.warn("[gemini-key] the stored Gemini key last failed a probe — it may be expired.");
      }
      return resolved.value.value;
    }
    // Refusals degrade to the env vars, then to "not configured" — the callers'
    // existing optional-key path.
  }
  return geminiKeyFromEnv();
}
