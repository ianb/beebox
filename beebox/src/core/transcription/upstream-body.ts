/**
 * Upstream error-body truncation, shared by every HQ arm.
 *
 * A leaf module on purpose: the arms (`whisper`, `openrouter`,
 * `voxtral-errors`) need this at construction time, and importing it from the
 * `index.js` barrel — which imports the arms — made the one *value* cycle in
 * this directory. The remaining barrel back-edges are `import type`, which
 * erases.
 */

/** `≤500` chars — enough to see the provider's reason without logging megabytes. */
const UPSTREAM_BODY_MAX_CHARS = 500;

/** Truncate an upstream error body to the length the manifest/job are willing to carry. */
export function truncateUpstreamBody(body: string): string {
  return body.length > UPSTREAM_BODY_MAX_CHARS ? body.slice(0, UPSTREAM_BODY_MAX_CHARS) : body;
}
