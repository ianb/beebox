/**
 * Resolve the Mistral API key for a box: the machine-level secret store's
 * `mistral` entry at `server` access (`docs/implemented-plans/secret-custody.md`).
 * `server` because the key is spent only inside server processes
 * (transcription), so an `agent` grant is never required and never asked for.
 *
 * The store is the only source. The transition window that also read
 * `_config/connectors/mistral.secret.json` and `BBX_MISTRAL_API_KEY` closed
 * once the store had proven itself in normal operation; a box with no grant
 * degrades exactly as an unconfigured box always did, through the caller's
 * "not configured" path.
 *
 * `boxRoot` stays optional because two transcription callers genuinely have no
 * box (`TranscribeAudioParams.boxRoot`). Grants are per-box, so with no box
 * there is nothing to resolve — and no env var left to fall back to.
 */

import { resolveSecret, type SecretRead } from "./secrets/resolve.js";

/** The store name this connector's key lives under. */
export const MISTRAL_SECRET_NAME = "mistral";

export async function getMistralApiKey(boxRoot: string | undefined, read: SecretRead): Promise<string | null> {
  if (boxRoot === undefined) return null;
  const resolved = await resolveSecret({
    boxRoot,
    name: MISTRAL_SECRET_NAME,
    purpose: "transcription",
    access: "server",
    observe: read.observe,
  });
  if (!resolved.ok) return null;
  if (resolved.value.suspect) {
    console.warn("[mistral-key] the stored Mistral key last failed a probe — it may be expired.");
  }
  return resolved.value.value;
}
