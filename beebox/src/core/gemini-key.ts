/**
 * Resolve the box's Gemini API key — the one behind audio questions
 * (`bbx chat ask-about-audio`) and scan-import's opt-in Gemini vision backend:
 * the machine store's `gemini` entry at `server` access
 * (`docs/implemented-plans/secret-custody.md`).
 *
 * This module exists to CONSOLIDATE what used to be the same two-env-var read
 * (`GEMINI_KEY`, then `SKE_GEMINI_API_KEY`) copied into four places
 * (`core/audio-question.ts`, `services/scan-vision.ts`,
 * `cli/commands/chat-audio.ts`, `trpc/routers/health.ts`). Those env vars were
 * retired with the rest of the transition window; the store is now the only
 * source.
 */

import { resolveSecret, type SecretRead } from "./secrets/resolve.js";

/** The store name this key lives under. */
const GEMINI_SECRET_NAME = "gemini";

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
  if (boxRoot === undefined) return null;
  const resolved = await resolveSecret({
    boxRoot,
    name: GEMINI_SECRET_NAME,
    purpose: read.purpose,
    access: "server",
    observe: read.observe,
  });
  if (!resolved.ok) return null;
  if (resolved.value.suspect) {
    console.warn("[gemini-key] the stored Gemini key last failed a probe — it may be expired.");
  }
  return resolved.value.value;
}
