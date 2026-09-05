/**
 * Resolve the box's Gemini API key — the one behind audio questions
 * (`bbx chat ask-about-audio`) and scan-import's opt-in Gemini vision backend.
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

import { refusalAllowsLegacyFallback } from "./secrets/legacy-fallback.js";
import { resolveSecret, type SecretRead } from "./secrets/resolve.js";

/** The store name this key lives under. */
const GEMINI_SECRET_NAME = "gemini";

/** The env fallbacks, in the order they have always been read. */
function geminiKeyFromEnv(): string | null {
  return process.env["GEMINI_KEY"] || process.env["SKE_GEMINI_API_KEY"] || null;
}

/**
 * How a caller is spending this key. The `purpose` is stated by the CALLER
 * rather than fixed here because this key has two genuinely different spends —
 * describing a scan and answering a question about a recording — and a single
 * hardcoded label made the access log claim every audio question was vision
 * work. `observe: false` is the status-only probe (see `resolveSecret`).
 */
export interface GeminiKeyRead extends SecretRead {
  /** Matches `SECRET_PURPOSE_PATTERN` — it goes verbatim into the access log. */
  purpose: string;
}

export async function getGeminiApiKey(boxRoot: string | undefined, read: GeminiKeyRead): Promise<string | null> {
  if (boxRoot !== undefined) {
    const resolved = await resolveSecret({
      boxRoot,
      name: GEMINI_SECRET_NAME,
      purpose: read.purpose,
      access: "server",
      observe: read.observe,
    });
    if (resolved.ok) {
      if (resolved.value.suspect) {
        console.warn("[gemini-key] the stored Gemini key last failed a probe — it may be expired.");
      }
      return resolved.value.value;
    }
    // Only "no such secret on this machine" degrades to the env vars; a
    // revoked, withheld, empty, or unreadable-store refusal is "not configured"
    // (`secrets/legacy-fallback.ts`) — the callers' existing optional-key path.
    if (!refusalAllowsLegacyFallback({ reader: "gemini-key", refusal: resolved.error })) return null;
  }
  return geminiKeyFromEnv();
}
